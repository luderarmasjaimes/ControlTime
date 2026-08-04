#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/version.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/strand.hpp>
#include <boost/config.hpp>
#include <iostream>
#include <string>
#include <thread>
#include <cstdlib>
#include <optional>

#include <nlohmann/json.hpp>
#include <pqxx/pqxx>
#include <libpq-fe.h>
#include <opencv2/opencv.hpp>
#include <boost/beast/websocket.hpp>
#include <deque>
#include <mutex>
#include <condition_variable>
#include <vector>
#include <memory>
#include <chrono>

// Basic blocking HTTP server with simple routing and Postgres-backed storage for blocks/connections
namespace beast = boost::beast;     // from <boost/beast.hpp>
namespace http = beast::http;       // from <boost/beast/http.hpp>
namespace net = boost::asio;        // from <boost/asio.hpp>
using tcp = boost::asio::ip::tcp;   // from <boost/asio/ip/tcp.hpp>
using json = nlohmann::json;

/** JSONB meta from request body. Do not use json::value("meta", nullptr): nlohmann throws type_error.302 if meta is an object. */
static json read_meta_object(const json& p)
{
    if(!p.contains("meta") || p["meta"].is_null())
        return json::object();
    const auto& m = p["meta"];
    if(m.is_object())
        return m;
    return json::object();
}

std::string db_url_from_env(){
    const char* e = std::getenv("DATABASE_URL");
    if(e) return std::string(e);
    return "postgresql://formula:formula@db:5432/formula";
}

// Forward declarations for global client list
static std::vector<std::shared_ptr<class ws_session>> g_clients;
static std::mutex g_clients_m;

void broadcast_to_clients(const std::string& msg);

void ensure_tables(pqxx::connection &c){
    pqxx::work w(c);
    w.exec(R"(
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      x DOUBLE PRECISION,
      y DOUBLE PRECISION,
      w DOUBLE PRECISION,
      h DOUBLE PRECISION,
      label TEXT,
      color TEXT,
      meta JSONB
    );
    CREATE TABLE IF NOT EXISTS connections (
      id SERIAL PRIMARY KEY,
      from_id TEXT,
      to_id TEXT,
      meta JSONB
    );
    CREATE TABLE IF NOT EXISTS rules (
      id SERIAL PRIMARY KEY,
      block_id TEXT,
      expr TEXT,
      meta JSONB
    );
        CREATE TABLE IF NOT EXISTS events (
            id SERIAL PRIMARY KEY,
            channel TEXT,
            payload JSONB,
            created_at TIMESTAMP DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS formula_sessions (
            id               BIGSERIAL PRIMARY KEY,
            usuario_nombre   VARCHAR(200),
            accion           VARCHAR(20) DEFAULT 'VISUALIZO',
            empresa_id       INTEGER,
            empresa_nombre   VARCHAR(200),
            mina_id          INTEGER,
            mina_nombre      VARCHAR(200),
            variable_id      INTEGER,
            variable_nombre  VARCHAR(200),
            fecha_inicio     TIMESTAMPTZ,
            fecha_fin        TIMESTAMPTZ,
            formula_json     JSONB,
            sp_sql_text      TEXT,
            total_lecturas   INTEGER,
            total_si         INTEGER,
            total_no         INTEGER,
            pct_alertas      DECIMAL(5,2),
            gps_lat          DECIMAL(10,7),
            gps_lon          DECIMAL(10,7),
            gps_accuracy     DECIMAL(8,2),
            gps_lugar        TEXT,
            ip_cliente       VARCHAR(45),
            user_agent       TEXT,
            created_at       TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_fsess_empresa  ON formula_sessions(empresa_id);
        CREATE INDEX IF NOT EXISTS idx_fsess_mina     ON formula_sessions(mina_id);
        CREATE INDEX IF NOT EXISTS idx_fsess_usuario  ON formula_sessions(usuario_nombre);
        CREATE INDEX IF NOT EXISTS idx_fsess_accion   ON formula_sessions(accion);
        CREATE INDEX IF NOT EXISTS idx_fsess_created  ON formula_sessions(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_fsess_formula  ON formula_sessions USING GIN (formula_json);
    )");
    // Multi-tenant isolation: scope every diagram to empresa+mina
    w.exec("ALTER TABLE blocks      ADD COLUMN IF NOT EXISTS diagram_id TEXT NOT NULL DEFAULT ''");
    w.exec("ALTER TABLE connections ADD COLUMN IF NOT EXISTS diagram_id TEXT NOT NULL DEFAULT ''");
    w.exec("CREATE INDEX IF NOT EXISTS idx_blocks_diagram ON blocks(diagram_id)");
    w.exec("CREATE INDEX IF NOT EXISTS idx_connections_diagram ON connections(diagram_id)");
    w.commit();
}

// helper: read request body string
std::string req_body(const http::request<http::string_body>& req){
    return req.body();
}

// handle a single connection (simple blocking model)
// forward declaration for ws session
namespace websocket = boost::beast::websocket;

struct ws_session: public std::enable_shared_from_this<ws_session> {
    websocket::stream<tcp::socket> ws;
    std::mutex write_m;
    bool active = true;

    ws_session(tcp::socket&& sock): ws(std::move(sock)){}

    void start(http::request<http::string_body> req){
        ws.accept(req);
        // add to global clients list after successful accept
        {
            std::lock_guard<std::mutex> lk(g_clients_m);
            g_clients.push_back(shared_from_this());
        }
        auto self = shared_from_this();
        // read loop handles incoming messages and connection close
        std::thread([self]{ self->read_loop(); }).detach();
        // ping loop: send heartbeat JSON to clients periodically
        std::thread([self]{
            try{
                while(self->active){
                    std::this_thread::sleep_for(std::chrono::seconds(20));
                    self->send_text("{\"type\":\"heartbeat\"}");
                }
            }catch(...){ self->active = false; }
        }).detach();
    }

    void read_loop(){
        try{
            for(;;){
                boost::beast::flat_buffer b;
                ws.read(b);
                // attempt to parse incoming text messages and respond to application-level pings
                try{
                    std::string msg = beast::buffers_to_string(b.data());
                    if(!msg.empty()){
                        // try parse JSON
                        try{
                            auto m = json::parse(msg);
                            if(m.contains("type") && m["type"] == "ping"){
                                json pong; pong["type"] = "pong"; pong["ts"] = (long)std::time(nullptr);
                                send_text(pong.dump());
                                continue;
                            }
                        }catch(...){}
                    }
                }catch(...){ }
            }
        }catch(...){
            active = false;
        }
    }

    void send_text(const std::string& msg){
        std::lock_guard<std::mutex> lk(write_m);
        if(!active) return;
        ws.text(true);
        ws.write(net::buffer(msg));
    }
};

// simple render cache to avoid re-rendering on frequent calls
static std::vector<unsigned char> g_render_cache;
static std::chrono::steady_clock::time_point g_render_ts = std::chrono::steady_clock::now() - std::chrono::seconds(10);
static std::mutex g_render_m;
void broadcast_to_clients(const std::string& msg){
    std::lock_guard<std::mutex> lk(g_clients_m);
    for(auto it = g_clients.begin(); it != g_clients.end(); ){
        auto s = *it;
        if(!s || !s->active){ it = g_clients.erase(it); }
        else{ try{ s->send_text(msg); }catch(...){ it = g_clients.erase(it); } if(it!=g_clients.end()) ++it; }
    }
}

void do_session(tcp::socket socket, const std::string& conn_str)
{
    try
    {
        pqxx::connection db(conn_str);
        ensure_tables(db);

        beast::flat_buffer buffer;
        for(;;)
        {
            http::request<http::string_body> req;
            http::read(socket, buffer, req);

            http::response<http::string_body> res{
                http::status::ok, req.version()};
            res.set(http::field::server, "formula-cpp/0.1");
            res.set(http::field::content_type, "application/json");
            // CORS headers to allow requests from frontend served on different origin (port)
            res.set("Access-Control-Allow-Origin", "*");
            res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
            res.keep_alive(req.keep_alive());

            try{
                std::string target = std::string(req.target());
                if(req.method() == http::verb::options){
                    // preflight CORS response
                    res.result(http::status::ok);
                    res.body() = "";
                    res.prepare_payload();
                    http::write(socket, res);
                    return;
                }

                if(req.method() == http::verb::get && (target == "/api/state" || target.rfind("/api/state?",0)==0)){
                    // parse diagram_id from query string (multi-tenant isolation)
                    std::string diagram_id;
                    {
                        auto qpos = target.find("diagram_id=");
                        if(qpos != std::string::npos){
                            size_t s = qpos + 11;
                            size_t e = target.find('&', s);
                            diagram_id = target.substr(s, e == std::string::npos ? std::string::npos : e - s);
                        }
                    }
                    // query blocks and connections scoped to diagram
                    pqxx::work w(db);
                    pqxx::result rb = w.exec_params("SELECT id,x,y,w,h,label,color,meta FROM blocks WHERE diagram_id=$1", diagram_id);
                    pqxx::result rc = w.exec_params("SELECT id,from_id,to_id,meta FROM connections WHERE diagram_id=$1", diagram_id);
                    json j;
                    j["blocks"] = json::array();
                    for(auto row: rb){
                        json b;
                        b["id"] = row["id"].c_str();
                        b["x"] = row["x"].as<double>();
                        b["y"] = row["y"].as<double>();
                        b["w"] = row["w"].as<double>();
                        b["h"] = row["h"].as<double>();
                        b["label"] = row["label"].c_str();
                        b["color"] = row["color"].is_null() ? json(nullptr) : json(row["color"].c_str());
                        try{ b["meta"] = json::parse(row["meta"].c_str()); } catch(...) { b["meta"] = nullptr; }
                        j["blocks"].push_back(b);
                    }
                    j["connections"] = json::array();
                    for(auto row: rc){
                        json c;
                        c["id"] = row["id"].as<int>();
                        c["from"] = row["from_id"].c_str();
                        c["to"] = row["to_id"].c_str();
                        try{ c["meta"] = json::parse(row["meta"].c_str()); } catch(...) { c["meta"] = nullptr; }
                        j["connections"].push_back(c);
                    }
                    res.body() = j.dump();
                }
                else if(req.method() == http::verb::get && target == "/api/variables"){
                    // GET all variables from the data dictionary
                    pqxx::work w(db);
                    pqxx::result rv = w.exec("SELECT id, name, type, description, unit FROM variables ORDER BY name");
                    json j = json::array();
                    for(auto row: rv){
                        json v;
                        v["id"] = row["id"].as<int>();
                        v["name"] = row["name"].c_str();
                        v["type"] = row["type"].c_str();
                        v["description"] = row["description"].is_null() ? json(nullptr) : json(row["description"].c_str());
                        v["unit"] = row["unit"].is_null() ? json(nullptr) : json(row["unit"].c_str());
                        j.push_back(v);
                    }
                    res.body() = j.dump();
                }
                else if(req.method() == http::verb::get && target == "/api/operators"){
                    // GET all operators (mathematical/logical) with icons
                    pqxx::work w(db);
                    pqxx::result ro = w.exec("SELECT id, symbol, name, category, icon_emoji, description FROM operators ORDER BY category, symbol");
                    json j = json::array();
                    for(auto row: ro){
                        json o;
                        o["id"] = row["id"].as<int>();
                        o["symbol"] = row["symbol"].c_str();
                        o["name"] = row["name"].c_str();
                        o["category"] = row["category"].is_null() ? json(nullptr) : json(row["category"].c_str());
                        o["icon"] = row["icon_emoji"].is_null() ? json(nullptr) : json(row["icon_emoji"].c_str());
                        o["description"] = row["description"].is_null() ? json(nullptr) : json(row["description"].c_str());
                        j.push_back(o);
                    }
                    res.body() = j.dump();
                }
                else if(req.method() == http::verb::get && target == "/api/render"){
                    // render a PNG preview using OpenCV with simple caching and enhanced 3D effects
                    try{
                        // check cache (valid for 2 seconds)
                        {
                            std::lock_guard<std::mutex> rlk(g_render_m);
                            auto now = std::chrono::steady_clock::now();
                            if(!g_render_cache.empty() && std::chrono::duration_cast<std::chrono::milliseconds>(now - g_render_ts).count() < 2000){
                                http::response<http::vector_body<unsigned char>> pres{http::status::ok, req.version()};
                                pres.set(http::field::server, "formula-cpp/0.1");
                                pres.set(http::field::content_type, "image/png");
                                pres.body() = g_render_cache;
                                pres.prepare_payload();
                                http::write(socket, pres);
                                return;
                            }
                        }

                        pqxx::work w(db);
                        pqxx::result rb = w.exec("SELECT id,x,y,w,h,label,color FROM blocks");
                        int width = 1400, height = 900;
                        cv::Mat img(height, width, CV_8UC3, cv::Scalar(245,245,250));
                        // draw soft grid with alpha blend effect
                        cv::Mat overlay = img.clone();
                        cv::Scalar gridc(230,230,230);
                        for(int x=0;x<width;x+=50) cv::line(overlay, cv::Point(x,0), cv::Point(x,height), gridc, 1, cv::LINE_AA);
                        for(int y=0;y<height;y+=50) cv::line(overlay, cv::Point(0,y), cv::Point(width,y), gridc, 1, cv::LINE_AA);
                        cv::addWeighted(overlay, 0.35, img, 0.65, 0, img);

                        // simulated directional light for shading
                        cv::Point2f lightDir(-1.0f, -0.8f); // from top-left
                        float lightLen = std::sqrt(lightDir.x*lightDir.x + lightDir.y*lightDir.y);
                        lightDir.x /= lightLen; lightDir.y /= lightLen;

                        for(auto row: rb){
                            std::string id = row["id"].c_str();
                            double x = row["x"].as<double>();
                            double y = row["y"].as<double>();
                            double wv = row["w"].as<double>();
                            double hv = row["h"].as<double>();
                            std::string label = row["label"].c_str();
                            std::string color = row["color"].is_null() ? "#99ccff" : row["color"].c_str();
                            int rr=153,gg=204,bb=255;
                            if(color.size()==7 && color[0]=='#'){
                                unsigned int r2,g2,b2; std::sscanf(color.c_str()+1, "%02x%02x%02x", &r2, &g2, &b2); rr=r2; gg=g2; bb=b2;
                            }

                            // shadow (soft)
                            int sx = 10, sy = 12;
                            cv::Rect shadowRect((int)x+sx, (int)y+sy, std::max(1,(int)wv), std::max(1,(int)hv));
                            cv::Mat shadowROI = img(shadowRect);
                            cv::Mat shadow = cv::Mat::zeros(shadowROI.size(), shadowROI.type());
                            shadow.setTo(cv::Scalar(20,20,20));
                            cv::GaussianBlur(shadow, shadow, cv::Size(31,31), 18);
                            cv::addWeighted(shadow, 0.55, shadowROI, 0.45, 0.0, shadowROI);

                            // main rect gradient with subtle specular highlight
                            cv::Mat grad((int)hv, std::max(1,(int)wv), CV_8UC3);
                            for(int yy=0; yy < (int)hv; ++yy){
                                double t = double(yy) / double(std::max(1,(int)hv));
                                int rfill = std::min(255, (int)(rr + (255-rr)*0.12*(1.0 - t)));
                                int gfill = std::min(255, (int)(gg + (255-gg)*0.12*(1.0 - t)));
                                int bfill = std::min(255, (int)(bb + (255-bb)*0.12*(1.0 - t)));
                                for(int xx=0; xx < std::max(1,(int)wv); ++xx){ grad.at<cv::Vec3b>(yy,xx) = cv::Vec3b(bfill, gfill, rfill); }
                            }
                            cv::Rect rect((int)x,(int)y,std::max(1,(int)wv),std::max(1,(int)hv));
                            grad.copyTo(img(rect));

                            // bevel / top face with light-based tint
                            int ex = std::max(8, (int)(std::min(16.0, hv*0.12)));
                            std::vector<cv::Point> topFace;
                            topFace.push_back(cv::Point((int)x, (int)y));
                            topFace.push_back(cv::Point((int)x + ex, (int)y - ex));
                            topFace.push_back(cv::Point((int)x + (int)wv + ex, (int)y - ex));
                            topFace.push_back(cv::Point((int)x + (int)wv, (int)y));
                            double ndotl = std::max(0.0, (double)(lightDir.x * 0.0 + lightDir.y * -1.0));
                            cv::Scalar topColor(std::min(255, bb + 20 + (int)(ndotl*30)), std::min(255, gg + 20 + (int)(ndotl*30)), std::min(255, rr + 20 + (int)(ndotl*30)));
                            cv::fillConvexPoly(img, topFace, topColor);

                            // soft border and subtle inner shadow
                            cv::rectangle(img, rect, cv::Scalar(18,18,18), 1, cv::LINE_AA);
                            cv::Mat inner = img(rect).clone();
                            cv::Mat innerBlur = inner.clone();
                            cv::GaussianBlur(inner, innerBlur, cv::Size(9,9), 6);
                            cv::addWeighted(img(rect), 0.85, innerBlur, 0.15, 0, img(rect));

                            // label with slight drop shadow for readability
                            cv::putText(img, label, cv::Point((int)x+10,(int)y+28), cv::FONT_HERSHEY_SIMPLEX, 0.7, cv::Scalar(20,20,20), 3, cv::LINE_AA);
                            cv::putText(img, label, cv::Point((int)x+10,(int)y+28), cv::FONT_HERSHEY_SIMPLEX, 0.7, cv::Scalar(245,245,245), 1, cv::LINE_AA);
                        }

                        // final vignette to give depth
                        cv::Mat vignette = img.clone();
                        for(int i=0;i<height;i++){
                            for(int j=0;j<width;j++){
                                double dx = (j - width/2.0) / (width/2.0);
                                double dy = (i - height/2.0) / (height/2.0);
                                double r = sqrt(dx*dx + dy*dy);
                                double factor = 1.0 - 0.25 * std::min(1.0, r);
                                cv::Vec3b &pix = vignette.at<cv::Vec3b>(i,j);
                                pix[0] = cv::saturate_cast<uchar>(pix[0] * factor);
                                pix[1] = cv::saturate_cast<uchar>(pix[1] * factor);
                                pix[2] = cv::saturate_cast<uchar>(pix[2] * factor);
                            }
                        }

                        std::vector<unsigned char> buf;
                        cv::imencode(".png", vignette, buf);

                        // update cache
                        {
                            std::lock_guard<std::mutex> rlk(g_render_m);
                            g_render_cache = buf;
                            g_render_ts = std::chrono::steady_clock::now();
                        }

                        http::response<http::vector_body<unsigned char>> pres{http::status::ok, req.version()};
                        pres.set(http::field::server, "formula-cpp/0.1");
                        pres.set(http::field::content_type, "image/png");
                        pres.body() = std::move(buf);
                        pres.prepare_payload();
                        http::write(socket, pres);
                        return;
                    }catch(const std::exception &e){
                        res.result(http::status::internal_server_error);
                        json err; err["error"] = std::string("render error: ") + e.what(); res.body() = err.dump();
                    }
                }
                else if(req.method() == http::verb::get && (target == "/ws" || (target.rfind("/ws?",0)==0))){
                    // WebSocket upgrade with optional token auth (query `?token=` or header `Authorization: Bearer <token>`)
                    // read expected token from env
                    std::string expected = std::getenv("AUTH_TOKEN") ? std::string(std::getenv("AUTH_TOKEN")) : std::string("devtoken");
                    std::string token;
                    // try Authorization header first
                    auto it = req.find(http::field::authorization);
                    if(it != req.end()){
                        std::string authh = it->value().to_string();
                        const std::string bearer = "Bearer ";
                        if(authh.rfind(bearer, 0) == 0) token = authh.substr(bearer.size());
                        else token = authh;
                    } else {
                        // fallback: parse token from query string if present
                        auto pos = target.find("token=");
                        if(pos != std::string::npos){ size_t start = pos + 6; size_t end = target.find('&', start); token = target.substr(start, (end==std::string::npos? std::string::npos : end-start)); }
                    }

                    if(token != expected){
                        res.result(http::status::unauthorized);
                        json err; err["error"] = std::string("unauthorized: missing/invalid token"); res.body() = err.dump();
                        res.prepare_payload();
                        http::write(socket, res);
                        return;
                    }

                    // token ok -> perform websocket upgrade
                    try{
                        auto s = std::make_shared<ws_session>(std::move(socket));
                        s->start(req);
                        // ws_session handles the socket
                        return;
                    }catch(const std::exception &e){
                        res.result(http::status::internal_server_error);
                        json err; err["error"] = std::string("ws upgrade failed: ") + e.what(); res.body() = err.dump();
                    }
                }
                else if(req.method() == http::verb::post && target == "/api/block"){
                    auto body = req_body(req);
                    json p = json::parse(body);
                    std::string id = p.value("id", "");
                    if(id.empty()){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"id required"})";
                    } else {
                        double x = p.value("x", 0.0);
                        double y = p.value("y", 0.0);
                        double wv = p.value("w", 120.0);
                        double hv = p.value("h", 60.0);
                        std::string label = p.value("label", id);
                        std::string color = p.value("color", "#99ccff");
                        std::string diagram_id = p.value("diagram_id", "");
                        json meta = read_meta_object(p);
                        pqxx::work t(db);
                        t.exec_params(
                            "INSERT INTO blocks (id,x,y,w,h,label,color,meta,diagram_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET x=EXCLUDED.x, y=EXCLUDED.y, w=EXCLUDED.w, h=EXCLUDED.h, label=EXCLUDED.label, color=EXCLUDED.color, meta=EXCLUDED.meta",
                            id, x, y, wv, hv, label, color, meta.dump(), diagram_id
                        );
                        t.commit();
                        // notify listeners using PostgreSQL NOTIFY with JSON payload (native low-latency)
                        try{
                            pqxx::work ev(db);
                            json je; je["type"] = "block_upsert"; je["id"] = id; je["x"] = x; je["y"] = y;
                            std::string payload = je.dump();
                            // use db.quote to safely escape payload
                            ev.exec("NOTIFY formula_changes, " + db.quote(payload));
                            // optional: keep events history
                            ev.exec_params("INSERT INTO events (channel,payload) VALUES ($1,$2)", "formula_changes", payload);
                            ev.commit();
                        }catch(const std::exception &e){ std::cerr << "notify error: " << e.what() << std::endl; }
                        res.body() = R"({"ok":true})";
                    }
                }
                else if(req.method() == http::verb::post && target == "/api/block/delete"){
                    auto body = req_body(req);
                    json p = json::parse(body);
                    std::string id = p.value("id", "");
                    if(id.empty()){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"id required"})";
                    } else {
                        pqxx::work t(db);
                        t.exec_params("DELETE FROM blocks WHERE id = $1", id);
                        t.commit();
                        try{
                            pqxx::work ev(db);
                            json je; je["type"] = "block_delete"; je["id"] = id;
                            std::string payload = je.dump();
                            ev.exec("NOTIFY formula_changes, " + db.quote(payload));
                            ev.exec_params("INSERT INTO events (channel,payload) VALUES ($1,$2)", "formula_changes", payload);
                            ev.commit();
                        }catch(const std::exception &e){ std::cerr << "notify error: " << e.what() << std::endl; }
                        res.body() = R"({"ok":true})";
                    }
                }
                else if(req.method() == http::verb::post && target == "/api/connection"){
                    auto body = req_body(req);
                    json p = json::parse(body);
                    std::string from = p.value("from", "");
                    std::string to = p.value("to", "");
                    if(from.empty() || to.empty()){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"from and to required"})";
                    } else {
                        json meta = read_meta_object(p);
                        std::string diagram_id = p.value("diagram_id", "");
                        pqxx::work t(db);
                        t.exec_params("INSERT INTO connections (from_id,to_id,meta,diagram_id) VALUES ($1,$2,$3,$4)", from, to, meta.dump(), diagram_id);
                        t.commit();
                        try{
                            pqxx::work ev(db);
                            json je; je["type"] = "connection_create"; je["from"] = from; je["to"] = to;
                            std::string payload = je.dump();
                            ev.exec("NOTIFY formula_changes, " + db.quote(payload));
                            ev.exec_params("INSERT INTO events (channel,payload) VALUES ($1,$2)", "formula_changes", payload);
                            ev.commit();
                        }catch(const std::exception &e){ std::cerr << "notify error: " << e.what() << std::endl; }
                        res.body() = R"({"ok":true})";
                    }
                }
                else if(req.method() == http::verb::post && target == "/api/connection/update"){
                    auto body = req_body(req);
                    json p = json::parse(body);
                    int cid = p.value("id", 0);
                    if(cid <= 0){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"id required"})";
                    } else {
                        json meta = read_meta_object(p);
                        pqxx::work t(db);
                        t.exec_params("UPDATE connections SET meta = $1::jsonb WHERE id = $2", meta.dump(), cid);
                        t.commit();
                        try{
                            pqxx::work ev(db);
                            json je;
                            je["type"] = "connection_update";
                            je["id"] = cid;
                            std::string payload = je.dump();
                            ev.exec("NOTIFY formula_changes, " + db.quote(payload));
                            ev.exec_params("INSERT INTO events (channel,payload) VALUES ($1,$2)", "formula_changes", payload);
                            ev.commit();
                        }catch(const std::exception &e){ std::cerr << "notify error: " << e.what() << std::endl; }
                        res.body() = R"({"ok":true})";
                    }
                }
                else if(req.method() == http::verb::post && target == "/api/connection/delete"){
                    auto body = req_body(req);
                    json p = json::parse(body);
                    int cid = p.value("id", 0);
                    if(cid <= 0){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"id required"})";
                    } else {
                        pqxx::work t(db);
                        t.exec_params("DELETE FROM connections WHERE id = $1", cid);
                        t.commit();
                        try{
                            pqxx::work ev(db);
                            json je;
                            je["type"] = "connection_delete";
                            je["id"] = cid;
                            std::string payload = je.dump();
                            ev.exec("NOTIFY formula_changes, " + db.quote(payload));
                            ev.exec_params("INSERT INTO events (channel,payload) VALUES ($1,$2)", "formula_changes", payload);
                            ev.commit();
                        }catch(const std::exception &e){ std::cerr << "notify error: " << e.what() << std::endl; }
                        res.body() = R"({"ok":true})";
                    }
                }
                else if(req.method() == http::verb::get && target.rfind("/api/rules", 0) == 0){
                    // GET /api/rules?block_id=<id>
                    std::string block_id;
                    auto qpos = target.find("block_id=");
                    if(qpos != std::string::npos){
                        size_t start = qpos + 9;
                        size_t end = target.find('&', start);
                        block_id = target.substr(start, end == std::string::npos ? std::string::npos : end - start);
                    }
                    pqxx::work w(db);
                    pqxx::result rr;
                    if(block_id.empty()){
                        rr = w.exec("SELECT id, block_id, expr FROM rules ORDER BY id");
                    } else {
                        rr = w.exec_params("SELECT id, block_id, expr FROM rules WHERE block_id = $1 ORDER BY id", block_id);
                    }
                    json j = json::array();
                    for(auto row: rr){
                        json r;
                        r["id"] = row["id"].as<int>();
                        r["block_id"] = row["block_id"].c_str();
                        r["expr"] = row["expr"].c_str();
                        j.push_back(r);
                    }
                    res.body() = j.dump();
                }
                else if(req.method() == http::verb::post && target == "/api/rule"){
                    auto body = req_body(req);
                    json p = json::parse(body);
                    std::string block_id = p.value("block_id", "");
                    std::string expr = p.value("expr", "");
                    if(block_id.empty() || expr.empty()){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"block_id and expr required"})";
                    } else {
                        json meta = read_meta_object(p);
                        pqxx::work t(db);
                        int rule_id = 0;
                        if(p.contains("id") && !p["id"].is_null() && p["id"].is_number()){
                            rule_id = p.value("id", 0);
                            t.exec_params("UPDATE rules SET block_id=$1, expr=$2, meta=$3::jsonb WHERE id=$4",
                                block_id, expr, meta.dump(), rule_id);
                        } else {
                            auto ins = t.exec_params("INSERT INTO rules (block_id,expr,meta) VALUES ($1,$2,$3) RETURNING id",
                                block_id, expr, meta.dump());
                            rule_id = ins[0][0].as<int>();
                        }
                        t.commit();
                        json resp; resp["ok"] = true; resp["id"] = rule_id;
                        res.body() = resp.dump();
                    }
                }
                else if(req.method() == http::verb::post && target == "/api/rule/delete"){
                    auto body = req_body(req);
                    json p = json::parse(body);
                    int rid = p.value("id", 0);
                    if(rid <= 0){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"id required"})";
                    } else {
                        pqxx::work t(db);
                        t.exec_params("DELETE FROM rules WHERE id = $1", rid);
                        t.commit();
                        res.body() = R"({"ok":true})";
                    }
                }
                // ── GET /api/catalogos — empresas y minas (selector global) ────────
                else if(req.method() == http::verb::get && target == "/api/catalogos"){
                    pqxx::work w(db);
                    // empresas
                    pqxx::result re = w.exec(
                        "SELECT id, codigo, nombre FROM mineria_empresas WHERE activo=TRUE ORDER BY nombre");
                    json emp = json::array();
                    for(auto row : re){
                        json r;
                        r["id"]     = row["id"].as<int>();
                        r["codigo"] = row["codigo"].c_str();
                        r["nombre"] = row["nombre"].c_str();
                        emp.push_back(r);
                    }
                    // minas
                    pqxx::result rm = w.exec(
                        "SELECT id, empresa_id, codigo, nombre, zona_tipo, altitud_msnm, umbral_temp_alerta "
                        "FROM mineria_minas WHERE activo=TRUE ORDER BY nombre");
                    json minas = json::array();
                    for(auto row : rm){
                        json r;
                        r["id"]                 = row["id"].as<int>();
                        r["empresa_id"]          = row["empresa_id"].as<int>();
                        r["codigo"]              = row["codigo"].c_str();
                        r["nombre"]              = row["nombre"].c_str();
                        r["zona_tipo"]           = row["zona_tipo"].c_str();
                        r["altitud_msnm"]        = row["altitud_msnm"].as<int>();
                        r["umbral_temp_alerta"]  = row["umbral_temp_alerta"].as<double>();
                        minas.push_back(r);
                    }
                    json j; j["empresas"] = emp; j["minas"] = minas;
                    res.body() = j.dump();
                }
                // ── GET /api/sensores?mina_id=X — sensores de una mina ─────────
                else if(req.method() == http::verb::get && target.rfind("/api/sensores", 0) == 0){
                    int mina_id = 0;
                    auto qpos = target.find("mina_id=");
                    if(qpos != std::string::npos){
                        size_t start = qpos + 8;
                        size_t end = target.find('&', start);
                        try{ mina_id = std::stoi(target.substr(start, end == std::string::npos ? std::string::npos : end - start)); }catch(...){}
                    }
                    pqxx::work w(db);
                    pqxx::result rs;
                    if(mina_id > 0){
                        rs = w.exec_params(
                            "SELECT s.id, s.codigo, s.nombre, s.modelo, s.fabricante, "
                            "       s.ubicacion, s.profundidad_m, "
                            "       v.id AS variable_id, v.nombre AS variable_nombre, "
                            "       v.unidad, v.tipo AS variable_tipo "
                            "FROM mineria_sensores s "
                            "JOIN mineria_variables v ON v.id = s.variable_id "
                            "WHERE s.mina_id = $1 AND s.activo = TRUE "
                            "ORDER BY s.codigo", mina_id);
                    } else {
                        rs = w.exec(
                            "SELECT s.id, s.codigo, s.nombre, s.modelo, s.fabricante, "
                            "       s.ubicacion, s.profundidad_m, "
                            "       v.id AS variable_id, v.nombre AS variable_nombre, "
                            "       v.unidad, v.tipo AS variable_tipo "
                            "FROM mineria_sensores s "
                            "JOIN mineria_variables v ON v.id = s.variable_id "
                            "WHERE s.activo = TRUE ORDER BY s.codigo");
                    }
                    json j = json::array();
                    for(auto row : rs){
                        json r;
                        r["id"]               = row["id"].as<int>();
                        r["codigo"]           = row["codigo"].c_str();
                        r["nombre"]           = row["nombre"].c_str();
                        r["modelo"]           = row["modelo"].is_null()      ? json(nullptr) : json(row["modelo"].c_str());
                        r["fabricante"]       = row["fabricante"].is_null()  ? json(nullptr) : json(row["fabricante"].c_str());
                        r["ubicacion"]        = row["ubicacion"].is_null()   ? json(nullptr) : json(row["ubicacion"].c_str());
                        r["profundidad_m"]    = row["profundidad_m"].is_null() ? json(nullptr) : json(row["profundidad_m"].as<double>());
                        r["variable_id"]      = row["variable_id"].as<int>();
                        r["variable_nombre"]  = row["variable_nombre"].c_str();
                        r["unidad"]           = row["unidad"].is_null()      ? json(nullptr) : json(row["unidad"].c_str());
                        r["variable_tipo"]    = row["variable_tipo"].is_null() ? json(nullptr) : json(row["variable_tipo"].c_str());
                        j.push_back(r);
                    }
                    res.body() = j.dump();
                }
                // ── GET /api/analysis/catalogos ─────────────────────────────────
                else if(req.method() == http::verb::get && target == "/api/analysis/catalogos"){
                    pqxx::work w(db);
                    pqxx::result rc = w.exec(
                        "SELECT empresa_id, empresa_codigo, empresa_nombre, "
                        "       mina_id, mina_codigo, mina_nombre, zona_tipo, "
                        "       altitud_msnm, umbral_temp_alerta, "
                        "       variable_id, variable_codigo, variable_nombre, unidad "
                        "FROM v_mineria_catalogos");
                    json j = json::array();
                    for(auto row : rc){
                        json r;
                        r["empresa_id"]          = row["empresa_id"].as<int>();
                        r["empresa_codigo"]       = row["empresa_codigo"].c_str();
                        r["empresa_nombre"]       = row["empresa_nombre"].c_str();
                        r["mina_id"]             = row["mina_id"].as<int>();
                        r["mina_codigo"]          = row["mina_codigo"].c_str();
                        r["mina_nombre"]          = row["mina_nombre"].c_str();
                        r["zona_tipo"]            = row["zona_tipo"].c_str();
                        r["altitud_msnm"]         = row["altitud_msnm"].as<int>();
                        r["umbral_temp_alerta"]   = row["umbral_temp_alerta"].as<double>();
                        r["variable_id"]          = row["variable_id"].as<int>();
                        r["variable_codigo"]      = row["variable_codigo"].c_str();
                        r["variable_nombre"]      = row["variable_nombre"].c_str();
                        r["unidad"]               = row["unidad"].c_str();
                        j.push_back(r);
                    }
                    res.body() = j.dump();
                }
                // ── POST /api/analysis/temperaturas ─────────────────────────────
                // Body: { empresa_id, mina_id, variable_id, fecha_inicio, fecha_fin }
                // Returns: array of SP results (max 2000 rows for chart performance)
                else if(req.method() == http::verb::post && target == "/api/analysis/temperaturas"){
                    auto body = req_body(req);
                    json p = json::parse(body);
                    int empresa_id  = p.value("empresa_id",  0);
                    int mina_id     = p.value("mina_id",     0);
                    int variable_id = p.value("variable_id", 0);
                    std::string fecha_ini = p.value("fecha_inicio", "");
                    std::string fecha_fin = p.value("fecha_fin",    "");
                    if(empresa_id <= 0 || mina_id <= 0 || variable_id <= 0 ||
                       fecha_ini.empty() || fecha_fin.empty()){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"Requeridos: empresa_id, mina_id, variable_id, fecha_inicio, fecha_fin"})";
                    } else {
                        pqxx::work w(db);
                        // Call the stored procedure; limit to 2000 rows for chart readability
                        pqxx::result rc = w.exec_params(
                            "SELECT timestamp_lectura, valor_original, calidad, "
                            "       umbral_alerta, condicion_resultado, "
                            "       valor_procesado, descripcion "
                            "FROM sp_proceso_temperatura($1,$2,$3,$4::timestamptz,$5::timestamptz) "
                            "LIMIT 2000",
                            empresa_id, mina_id, variable_id, fecha_ini, fecha_fin);
                        json rows = json::array();
                        for(auto row : rc){
                            json r;
                            r["ts"]          = row["timestamp_lectura"].c_str();
                            r["original"]    = row["valor_original"].is_null()     ? json(nullptr) : json(row["valor_original"].as<double>());
                            r["calidad"]     = row["calidad"].as<int>();
                            r["umbral"]      = row["umbral_alerta"].as<double>();
                            r["condicion"]   = row["condicion_resultado"].c_str();
                            r["procesado"]   = row["valor_procesado"].is_null()    ? json(nullptr) : json(row["valor_procesado"].as<double>());
                            r["descripcion"] = row["descripcion"].c_str();
                            rows.push_back(r);
                        }
                        json out;
                        out["count"] = (int)rows.size();
                        out["rows"]  = rows;
                        res.body() = out.dump();
                    }
                }
                // ── POST /api/analysis/guardar ───────────────────────────────
                // Saves a complete formula session snapshot to formula_sessions table
                else if(req.method() == http::verb::post && target == "/api/analysis/guardar"){
                    auto body = req_body(req);
                    json p = json::parse(body);

                    // Extract GPS optional values (null if not provided)
                    std::optional<double> gps_lat_v, gps_lon_v, gps_acc_v;
                    std::optional<std::string> gps_lugar_v;
                    if(p.contains("gps_lat") && !p["gps_lat"].is_null()){
                        gps_lat_v = p["gps_lat"].get<double>();
                        gps_lon_v = p.contains("gps_lon") && !p["gps_lon"].is_null()
                                    ? std::optional<double>(p["gps_lon"].get<double>()) : std::nullopt;
                        gps_acc_v = p.contains("gps_accuracy") && !p["gps_accuracy"].is_null()
                                    ? std::optional<double>(p["gps_accuracy"].get<double>()) : std::nullopt;
                    }
                    if(p.contains("gps_lugar") && !p["gps_lugar"].is_null()){
                        std::string g = p["gps_lugar"].get<std::string>();
                        if(!g.empty()) gps_lugar_v = g;
                    }
                    std::string formula_json_str = p.contains("formula_json")
                        ? p["formula_json"].dump() : "null";
                    std::string sp_sql = p.value("sp_sql_text","");
                    std::string user_agent_hdr = std::string(req[http::field::user_agent]);

                    pqxx::work w(db);
                    pqxx::result rc = w.exec_params(
                        "INSERT INTO formula_sessions "
                        "(usuario_nombre,accion,empresa_id,empresa_nombre,mina_id,mina_nombre,"
                        " variable_id,variable_nombre,fecha_inicio,fecha_fin,"
                        " formula_json,sp_sql_text,"
                        " total_lecturas,total_si,total_no,pct_alertas,"
                        " gps_lat,gps_lon,gps_accuracy,gps_lugar,"
                        " ip_cliente,user_agent) "
                        "VALUES($1,$2,$3,$4,$5,$6,$7,$8,"
                        " $9::timestamptz,$10::timestamptz,"
                        " $11::jsonb,$12,"
                        " $13,$14,$15,$16,"
                        " $17,$18,$19,$20,"
                        " $21,$22) "
                        "RETURNING id, to_char(created_at,'YYYY-MM-DD HH24:MI:SS TZ') AS created_at",
                        p.value("usuario_nombre","Anónimo"),
                        p.value("accion","VISUALIZO"),
                        p.value("empresa_id",0),
                        p.value("empresa_nombre",""),
                        p.value("mina_id",0),
                        p.value("mina_nombre",""),
                        p.value("variable_id",0),
                        p.value("variable_nombre",""),
                        p.value("fecha_inicio",""),
                        p.value("fecha_fin",""),
                        formula_json_str,
                        sp_sql,
                        p.value("total_lecturas",0),
                        p.value("total_si",0),
                        p.value("total_no",0),
                        p.value("pct_alertas",0.0),
                        gps_lat_v,
                        gps_lon_v,
                        gps_acc_v,
                        gps_lugar_v,
                        p.value("ip_cliente",""),
                        user_agent_hdr
                    );
                    w.commit();
                    json out;
                    out["ok"] = true;
                    out["id"] = rc[0]["id"].as<long long>();
                    out["created_at"] = rc[0]["created_at"].c_str();
                    res.body() = out.dump();
                }
                // ── GET /api/analysis/sesiones ───────────────────────────────
                // Returns saved formula sessions; supports ?empresa_id=&mina_id=&usuario=&accion=&limit=
                else if(req.method() == http::verb::get && target.rfind("/api/analysis/sesiones",0) == 0 &&
                        (target.size() == std::string("/api/analysis/sesiones").size() ||
                         target[std::string("/api/analysis/sesiones").size()] == '?')){
                    // Parse query string
                    std::string empresa_filter, mina_filter, usuario_filter, accion_filter;
                    std::string variable_filter, fecha_ini_filter, fecha_fin_filter;
                    int limit_v = 100;
                    int page_v  = 1;
                    auto qpos = target.find('?');
                    if(qpos != std::string::npos){
                        std::string qs = target.substr(qpos+1);
                        auto parse_qs = [&](const std::string& key) -> std::string {
                            auto p2 = qs.find(key + "=");
                            if(p2 == std::string::npos) return "";
                            size_t s = p2 + key.size() + 1;
                            size_t e = qs.find('&', s);
                            return qs.substr(s, e == std::string::npos ? std::string::npos : e - s);
                        };
                        empresa_filter     = parse_qs("empresa_id");
                        mina_filter        = parse_qs("mina_id");
                        variable_filter    = parse_qs("variable_id");
                        usuario_filter     = parse_qs("usuario");
                        accion_filter      = parse_qs("accion");
                        fecha_ini_filter   = parse_qs("fecha_inicio");
                        fecha_fin_filter   = parse_qs("fecha_fin");
                        std::string lim    = parse_qs("limit");
                        std::string pg     = parse_qs("page");
                        if(!lim.empty()) try{ limit_v = std::stoi(lim); }catch(...){}
                        if(!pg.empty())  try{ page_v  = std::max(1, std::stoi(pg)); }catch(...){}
                    }
                    pqxx::work w(db);
                    // Count query for pagination
                    std::string where_clause = " WHERE 1=1 ";
                    if(!empresa_filter.empty())   where_clause += " AND empresa_id = " + w.quote(empresa_filter);
                    if(!mina_filter.empty())       where_clause += " AND mina_id = " + w.quote(mina_filter);
                    if(!variable_filter.empty())   where_clause += " AND variable_id = " + w.quote(variable_filter);
                    if(!usuario_filter.empty())    where_clause += " AND lower(usuario_nombre) LIKE lower('%" + w.esc(usuario_filter) + "%')";
                    if(!accion_filter.empty())     where_clause += " AND accion = " + w.quote(accion_filter);
                    if(!fecha_ini_filter.empty())  where_clause += " AND fecha_inicio >= " + w.quote(fecha_ini_filter) + "::timestamptz";
                    if(!fecha_fin_filter.empty())  where_clause += " AND fecha_fin <= " + w.quote(fecha_fin_filter) + "::timestamptz";

                    // Total count
                    pqxx::result cnt = w.exec("SELECT COUNT(*) FROM formula_sessions" + where_clause);
                    long long total_count = cnt[0][0].as<long long>();
                    int total_pages = (int)std::ceil((double)total_count / (double)limit_v);
                    if(total_pages < 1) total_pages = 1;
                    int offset_v = (page_v - 1) * limit_v;

                    std::string sql =
                        "SELECT id, usuario_nombre, accion, empresa_id, empresa_nombre, "
                        "       mina_id, mina_nombre, variable_id, variable_nombre, "
                        "       to_char(fecha_inicio,'YYYY-MM-DD HH24:MI') AS fecha_inicio, "
                        "       to_char(fecha_fin,'YYYY-MM-DD HH24:MI') AS fecha_fin, "
                        "       total_lecturas, total_si, total_no, pct_alertas, "
                        "       gps_lat, gps_lon, gps_accuracy, gps_lugar, "
                        "       to_char(created_at,'YYYY-MM-DD HH24:MI:SS TZ') AS created_at "
                        "FROM formula_sessions" + where_clause +
                        " ORDER BY created_at DESC LIMIT " + std::to_string(limit_v) +
                        " OFFSET " + std::to_string(offset_v);

                    pqxx::result rc = w.exec(sql);
                    json rows = json::array();
                    for(auto row : rc){
                        json r;
                        r["id"]             = row["id"].as<long long>();
                        r["usuario_nombre"] = row["usuario_nombre"].is_null() ? "" : row["usuario_nombre"].c_str();
                        r["accion"]         = row["accion"].is_null() ? "" : row["accion"].c_str();
                        r["empresa_id"]     = row["empresa_id"].is_null() ? 0 : row["empresa_id"].as<int>();
                        r["empresa_nombre"] = row["empresa_nombre"].is_null() ? "" : row["empresa_nombre"].c_str();
                        r["mina_id"]        = row["mina_id"].is_null() ? 0 : row["mina_id"].as<int>();
                        r["mina_nombre"]    = row["mina_nombre"].is_null() ? "" : row["mina_nombre"].c_str();
                        r["variable_id"]    = row["variable_id"].is_null() ? 0 : row["variable_id"].as<int>();
                        r["variable_nombre"]= row["variable_nombre"].is_null() ? "" : row["variable_nombre"].c_str();
                        r["fecha_inicio"]   = row["fecha_inicio"].is_null() ? "" : row["fecha_inicio"].c_str();
                        r["fecha_fin"]      = row["fecha_fin"].is_null() ? "" : row["fecha_fin"].c_str();
                        r["total_lecturas"] = row["total_lecturas"].is_null() ? 0 : row["total_lecturas"].as<int>();
                        r["total_si"]       = row["total_si"].is_null() ? 0 : row["total_si"].as<int>();
                        r["total_no"]       = row["total_no"].is_null() ? 0 : row["total_no"].as<int>();
                        r["pct_alertas"]    = row["pct_alertas"].is_null() ? 0.0 : row["pct_alertas"].as<double>();
                        if(!row["gps_lat"].is_null()) r["gps_lat"] = row["gps_lat"].as<double>();
                        if(!row["gps_lon"].is_null()) r["gps_lon"] = row["gps_lon"].as<double>();
                        if(!row["gps_accuracy"].is_null()) r["gps_accuracy"] = row["gps_accuracy"].as<double>();
                        r["gps_lugar"]      = row["gps_lugar"].is_null() ? "" : row["gps_lugar"].c_str();
                        r["created_at"]     = row["created_at"].is_null() ? "" : row["created_at"].c_str();
                        rows.push_back(r);
                    }
                    json out;
                    out["total"]       = total_count;
                    out["page"]        = page_v;
                    out["per_page"]    = limit_v;
                    out["total_pages"] = total_pages;
                    out["count"]       = (int)rows.size();
                    out["sesiones"]    = rows;
                    res.body() = out.dump();
                }
                // ── GET /api/analysis/sesiones/:id ───────────────────────────
                // Returns a single session including full formula_json
                else if(req.method() == http::verb::get &&
                        target.rfind("/api/analysis/sesiones/",0) == 0 &&
                        target.find("/restaurar") == std::string::npos){
                    std::string id_str = target.substr(std::string("/api/analysis/sesiones/").size());
                    auto qp = id_str.find('?'); if(qp != std::string::npos) id_str = id_str.substr(0,qp);
                    long long sess_id = 0;
                    try{ sess_id = std::stoll(id_str); }catch(...){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"invalid id"})";
                        res.prepare_payload(); http::write(socket, res); break;
                    }
                    pqxx::work w(db);
                    pqxx::result rc = w.exec_params(
                        "SELECT id, usuario_nombre, accion, empresa_id, empresa_nombre, "
                        "       mina_id, mina_nombre, variable_id, variable_nombre, "
                        "       to_char(fecha_inicio,'YYYY-MM-DD HH24:MI') AS fecha_inicio, "
                        "       to_char(fecha_fin,'YYYY-MM-DD HH24:MI') AS fecha_fin, "
                        "       formula_json::text AS formula_json, "
                        "       total_lecturas, total_si, total_no, pct_alertas, "
                        "       gps_lat, gps_lon, gps_accuracy, gps_lugar, "
                        "       to_char(created_at,'YYYY-MM-DD HH24:MI:SS TZ') AS created_at "
                        "FROM formula_sessions WHERE id = $1", sess_id);
                    if(rc.empty()){
                        res.result(http::status::not_found);
                        res.body() = R"({"error":"session not found"})";
                        res.prepare_payload(); http::write(socket, res); break;
                    }
                    auto row = rc[0];
                    json r;
                    r["id"]             = row["id"].as<long long>();
                    r["usuario_nombre"] = row["usuario_nombre"].is_null() ? "" : row["usuario_nombre"].c_str();
                    r["accion"]         = row["accion"].is_null() ? "" : row["accion"].c_str();
                    r["empresa_id"]     = row["empresa_id"].is_null() ? 0 : row["empresa_id"].as<int>();
                    r["empresa_nombre"] = row["empresa_nombre"].is_null() ? "" : row["empresa_nombre"].c_str();
                    r["mina_id"]        = row["mina_id"].is_null() ? 0 : row["mina_id"].as<int>();
                    r["mina_nombre"]    = row["mina_nombre"].is_null() ? "" : row["mina_nombre"].c_str();
                    r["variable_id"]    = row["variable_id"].is_null() ? 0 : row["variable_id"].as<int>();
                    r["variable_nombre"]= row["variable_nombre"].is_null() ? "" : row["variable_nombre"].c_str();
                    r["fecha_inicio"]   = row["fecha_inicio"].is_null() ? "" : row["fecha_inicio"].c_str();
                    r["fecha_fin"]      = row["fecha_fin"].is_null() ? "" : row["fecha_fin"].c_str();
                    r["total_lecturas"] = row["total_lecturas"].is_null() ? 0 : row["total_lecturas"].as<int>();
                    r["total_si"]       = row["total_si"].is_null() ? 0 : row["total_si"].as<int>();
                    r["total_no"]       = row["total_no"].is_null() ? 0 : row["total_no"].as<int>();
                    r["pct_alertas"]    = row["pct_alertas"].is_null() ? 0.0 : row["pct_alertas"].as<double>();
                    if(!row["gps_lat"].is_null()) r["gps_lat"] = row["gps_lat"].as<double>();
                    if(!row["gps_lon"].is_null()) r["gps_lon"] = row["gps_lon"].as<double>();
                    if(!row["gps_accuracy"].is_null()) r["gps_accuracy"] = row["gps_accuracy"].as<double>();
                    r["gps_lugar"]      = row["gps_lugar"].is_null() ? "" : row["gps_lugar"].c_str();
                    r["created_at"]     = row["created_at"].is_null() ? "" : row["created_at"].c_str();
                    // Parse formula_json from text
                    if(!row["formula_json"].is_null()){
                        try{ r["formula_json"] = json::parse(row["formula_json"].c_str()); }
                        catch(...){ r["formula_json"] = nullptr; }
                    } else {
                        r["formula_json"] = nullptr;
                    }
                    res.body() = r.dump();
                }
                // ── POST /api/analysis/sesiones/:id/restaurar ───────────────
                // Replaces current blocks/connections with the snapshot stored in formula_json
                else if(req.method() == http::verb::post &&
                        target.rfind("/api/analysis/sesiones/",0) == 0 &&
                        target.find("/restaurar") != std::string::npos){
                    std::string id_str = target.substr(std::string("/api/analysis/sesiones/").size());
                    auto slash = id_str.find('/'); if(slash != std::string::npos) id_str = id_str.substr(0,slash);
                    long long sess_id = 0;
                    try{ sess_id = std::stoll(id_str); }catch(...){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"invalid id"})";
                        res.prepare_payload(); http::write(socket, res); break;
                    }
                    pqxx::work w(db);
                    // Fetch formula_json and tenant keys (diagram scope MUST match empresa+mina)
                    pqxx::result frc = w.exec_params(
                        "SELECT formula_json::text, empresa_id, mina_id FROM formula_sessions WHERE id = $1", sess_id);
                    if(frc.empty() || frc[0][0].is_null()){
                        res.result(http::status::not_found);
                        res.body() = R"({"error":"session not found or has no formula_json"})";
                        res.prepare_payload(); http::write(socket, res); break;
                    }
                    int sess_empresa = frc[0][1].is_null() ? 0 : frc[0][1].as<int>();
                    int sess_mina    = frc[0][2].is_null() ? 0 : frc[0][2].as<int>();
                    if(sess_empresa <= 0 || sess_mina <= 0){
                        res.result(http::status::unprocessable_entity);
                        res.body() = "{\"error\":\"La sesion no tiene empresa_id/mina_id validos para restaurar el diagrama\"}";
                        res.prepare_payload(); http::write(socket, res); break;
                    }
                    // Canonical tenant diagram id (same as FORMULA editor getDiagramId base: emp{e}_mina{m})
                    std::string target_diagram_id = std::string("emp") + std::to_string(sess_empresa)
                        + "_mina" + std::to_string(sess_mina);
                    json fj;
                    try{ fj = json::parse(frc[0][0].c_str()); }
                    catch(...){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"could not parse formula_json"})";
                        res.prepare_payload(); http::write(socket, res); break;
                    }
                    // Guard: formula_json must be a non-null object with a non-empty blocks array
                    if(fj.is_null() || !fj.is_object() ||
                       !fj.contains("blocks") || !fj["blocks"].is_array()){
                        res.result(http::status::unprocessable_entity);
                        res.body() = "{\"error\":\"Esta sesion no contiene un diagrama guardado (formula_json vacio)\"}";
                        res.prepare_payload(); http::write(socket, res); break;
                    }
                    if(fj["blocks"].empty()){
                        res.result(http::status::unprocessable_entity);
                        res.body() = "{\"error\":\"Esta sesion tiene formula_json sin bloques (snapshot vacío). Use Guardar Fórmula desde analisis con empresa/mina seleccionados, o re-exporte el diagrama.\"}";
                        res.prepare_payload(); http::write(socket, res); break;
                    }
                    // Replace ONLY this diagram_id (never delete all rows — empty diagram_id broke multi-tenant)
                    w.exec_params("DELETE FROM connections WHERE diagram_id=$1", target_diagram_id);
                    w.exec_params("DELETE FROM rules WHERE block_id IN (SELECT id FROM blocks WHERE diagram_id=$1)", target_diagram_id);
                    w.exec_params("DELETE FROM blocks WHERE diagram_id=$1", target_diagram_id);
                    // Re-insert blocks
                    if(fj.contains("blocks") && fj["blocks"].is_array()){
                        for(auto& b : fj["blocks"]){
                            std::string bid = b.value("id","");
                            if(bid.empty()) continue;
                            double bx = b.value("x",0.0), by = b.value("y",0.0);
                            double bw = b.value("w",120.0), bh = b.value("h",60.0);
                            std::string blabel = b.value("label","");
                            std::string bcolor = b.value("color","#4f8ef7");
                            // Normalize: CONDICION tipo must always carry blockType=decision
                            json bmeta_obj = b.contains("meta") && b["meta"].is_object() ? b["meta"] : json::object();
                            if(bmeta_obj.value("tipo","") == "CONDICION"){
                                bmeta_obj["blockType"] = "decision";
                            }
                            std::string bmeta = bmeta_obj.dump();
                            w.exec_params(
                                "INSERT INTO blocks(id,x,y,w,h,label,color,meta,diagram_id) "
                                "VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) "
                                "ON CONFLICT(id) DO UPDATE SET x=EXCLUDED.x,y=EXCLUDED.y,w=EXCLUDED.w,h=EXCLUDED.h,"
                                "label=EXCLUDED.label,color=EXCLUDED.color,meta=EXCLUDED.meta,diagram_id=EXCLUDED.diagram_id",
                                bid, bx, by, bw, bh, blabel, bcolor, bmeta, target_diagram_id);
                        }
                    }
                    // Re-insert connections (from_id / to_id are TEXT, new sequential IDs fine)
                    if(fj.contains("connections") && fj["connections"].is_array()){
                        for(auto& c : fj["connections"]){
                            std::string cfrom = c.value("from_id","");
                            // connections can have "from" or "from_id"
                            if(cfrom.empty()) cfrom = c.value("from","");
                            std::string cto   = c.value("to_id","");
                            if(cto.empty()) cto = c.value("to","");
                            if(cfrom.empty() || cto.empty()) continue;
                            std::string cmeta = c.contains("meta") ? c["meta"].dump() : "{}";
                            w.exec_params(
                                "INSERT INTO connections(from_id,to_id,meta,diagram_id) VALUES($1,$2,$3::jsonb,$4)",
                                cfrom, cto, cmeta, target_diagram_id);
                        }
                    }
                    w.commit();
                    // Broadcast state change via WebSocket event
                    json evt; evt["type"] = "session_restored"; evt["session_id"] = sess_id;
                    json ins; ins["type"] = "state_changed"; ins["payload"] = evt;
                    try{
                        pqxx::work we(db);
                        we.exec_params("INSERT INTO events(channel,payload) VALUES('state',$1::jsonb)", ins.dump());
                        we.commit();
                    }catch(...){}
                    json out; out["ok"] = true; out["session_id"] = sess_id;
                    res.body() = out.dump();
                }
                else {
                    res.result(http::status::not_found);
                    res.body() = R"({"error":"not found"})";
                }
            }catch(const std::exception &e){
                res.result(http::status::internal_server_error);
                json err; err["error"] = e.what(); res.body() = err.dump();
            }

            res.prepare_payload();
            http::write(socket, res);
            break; // close after handling single request
        }
    }
    catch(std::exception const& e)
    {
        std::cerr << "session error: " << e.what() << std::endl;
    }
}

int main(int argc, char** argv)
{
    try
    {
        auto const address = net::ip::make_address("0.0.0.0");
        unsigned short port = 8020;

        std::string dburl = db_url_from_env();
        std::cout << "Using DATABASE_URL=" << dburl << std::endl;

        // IMPORTANT: Ensure database tables exist BEFORE starting server
        try{
            pqxx::connection init_c(dburl);
            ensure_tables(init_c);
            std::cerr << "✓ Database tables ensured successfully" << std::endl;
        }catch(const std::exception &e){ 
            std::cerr << "✗ FATAL: Could not create tables: " << e.what() << std::endl; 
            return EXIT_FAILURE;
        }

        net::io_context ioc{1};
        tcp::acceptor acceptor{ioc, {address, port}};
        std::cout << "formula_cpp_backend listening on port " << port << std::endl;

        // Start simple polling thread for events (table-based, no LISTEN complexity)
        std::thread([dburl]{
            int last_event_id = 0;
            while(true){
                try{
                    pqxx::connection c(dburl);
                    pqxx::work w(c);
                    pqxx::result result = w.exec("SELECT id, payload::text FROM events WHERE id > " + w.quote(last_event_id) + " ORDER BY id LIMIT 100");
                    for(auto row : result){
                        int event_id = row[0].as<int>();
                        std::string payload = row[1].as<std::string>();
                        last_event_id = std::max(last_event_id, event_id);
                        try{ broadcast_to_clients(payload); }catch(...){ }
                    }
                    w.commit();
                }catch(const std::exception &e){ 
                    // suppressed: transient DB errors are expected during polling
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(200));
            }
        }).detach();

        // heartbeat thread: broadcast heartbeats to WS clients to keep connections healthy
        std::thread([]{
            while(true){
                std::this_thread::sleep_for(std::chrono::seconds(30));
                json hb; hb["type"] = "heartbeat"; hb["ts"] = (long)std::time(nullptr);
                broadcast_to_clients(hb.dump());
            }
        }).detach();

        for(;;)
        {
            tcp::socket socket{ioc};
            acceptor.accept(socket);
            std::thread([s = std::move(socket), db = dburl]() mutable { do_session(std::move(s), db); }).detach();
        }
    }
    catch(std::exception const& e)
    {
        std::cerr << "Fatal error: " << e.what() << std::endl;
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}

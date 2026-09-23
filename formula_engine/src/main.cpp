#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/core/tcp_stream.hpp>
#include <boost/beast/version.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/strand.hpp>
#include <boost/asio/connect.hpp>
#include <boost/config.hpp>
#include <iostream>
#include <string>
#include <thread>
#include <cstdlib>
#include <cstring>
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
        CREATE TABLE IF NOT EXISTS operators (
            id SERIAL PRIMARY KEY,
            symbol TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category TEXT,
            icon_emoji TEXT,
            description TEXT,
            precedence INT DEFAULT 0,
            meta JSONB,
            created_at TIMESTAMP DEFAULT now()
        );
    )");
    // ADR-188: `blocks`/`connections` ya usaban un `diagram_id TEXT` genérico
    // (antes 'empX_minaY' del catálogo fake) -- se mantiene la columna tal
    // cual, solo cambia el VALOR que el frontend le pone (ahora el sensor_id
    // real, ver getDiagramId() en app.js). No hace falta migración de esquema.
    w.exec("ALTER TABLE blocks      ADD COLUMN IF NOT EXISTS diagram_id TEXT NOT NULL DEFAULT ''");
    w.exec("ALTER TABLE connections ADD COLUMN IF NOT EXISTS diagram_id TEXT NOT NULL DEFAULT ''");
    w.exec("CREATE INDEX IF NOT EXISTS idx_blocks_diagram ON blocks(diagram_id)");
    w.exec("CREATE INDEX IF NOT EXISTS idx_connections_diagram ON connections(diagram_id)");
    // Paleta de operadores (aritmética/comparación/lógicos/funciones) --
    // agnóstica de tipo de sensor, sigue siendo real y reusable. INSERT
    // idempotente (ON CONFLICT DO NOTHING sobre symbol UNIQUE) porque
    // ensure_tables() corre en cada conexión aceptada, no solo al arrancar.
    w.exec(R"(
        INSERT INTO operators (symbol, name, category, icon_emoji, description, precedence) VALUES
        ('+', 'Suma', 'arithmetic', '➕', 'Suma dos valores', 1),
        ('-', 'Resta', 'arithmetic', '➖', 'Resta dos valores', 1),
        ('*', 'Multiplicación', 'arithmetic', '✖️', 'Multiplica dos valores', 2),
        ('/', 'División', 'arithmetic', '➗', 'Divide dos valores', 2),
        ('%', 'Módulo', 'arithmetic', '🔲', 'Resto de la división', 2),
        ('^', 'Potencia', 'arithmetic', '📌', 'Eleva a potencia', 3),
        ('=', 'Igual', 'comparison', '🟰', 'Verifica igualdad', 0),
        ('==', 'Estrictamente igual', 'comparison', '➡️', 'Comparación estricta', 0),
        ('!=', 'No igual', 'comparison', '❌', 'Verifica desigualdad', 0),
        ('>', 'Mayor que', 'comparison', '▶️', 'Mayor que', 0),
        ('<', 'Menor que', 'comparison', '◀️', 'Menor que', 0),
        ('>=', 'Mayor o igual', 'comparison', '▶️=', 'Mayor o igual que', 0),
        ('<=', 'Menor o igual', 'comparison', '◀️=', 'Menor o igual que', 0),
        ('AND', 'Y lógico', 'logical', '✔️', 'Operación lógica AND', 0),
        ('&&', 'Y (C-style)', 'logical', '✔️✔️', 'Operación AND alternativa', 0),
        ('OR', 'O lógico', 'logical', '❌', 'Operación lógica OR', 0),
        ('||', 'O (C-style)', 'logical', '❌❌', 'Operación OR alternativa', 0),
        ('NOT', 'No lógico', 'logical', '🚫', 'Operación lógica NOT', 3),
        ('!', 'Negación', 'logical', '‼️', 'Negación de valor', 3),
        ('sqrt', 'Raíz cuadrada', 'functions', '√', 'Calcula raíz cuadrada', 4),
        ('abs', 'Valor absoluto', 'functions', '📊', 'Valor absoluto', 4),
        ('round', 'Redondeo', 'functions', '🔄', 'Redondea al entero más cercano', 4),
        ('floor', 'Piso', 'functions', '🔻', 'Redondea hacia abajo', 4),
        ('ceil', 'Techo', 'functions', '🔺', 'Redondea hacia arriba', 4),
        ('pow', 'Potencia (func)', 'functions', '📈', 'Calcula a^b', 4),
        ('log', 'Logaritmo', 'functions', '📉', 'Logaritmo natural', 4),
        ('exp', 'Exponencial', 'functions', 'ⓔ', 'Calcula e^x', 4),
        ('sin', 'Seno', 'functions', '〰️', 'Función trigonométrica sin', 4),
        ('cos', 'Coseno', 'functions', '〰️', 'Función trigonométrica cos', 4),
        ('tan', 'Tangente', 'functions', '↗️', 'Función trigonométrica tan', 4),
        ('max', 'Máximo', 'functions', '📈', 'Valor máximo entre dos números', 4),
        ('min', 'Mínimo', 'functions', '📉', 'Valor mínimo entre dos números', 4),
        ('avg', 'Promedio', 'functions', '📊', 'Calcula el promedio', 4),
        ('?', 'Operador ternar', 'conditional', '❓', 'Condición ? valor_si : valor_no', 0),
        (':', 'Separador ternar', 'conditional', ':', 'Separador en operador ternario', 0)
        ON CONFLICT (symbol) DO NOTHING;
    )");
    w.commit();
}

// helper: read request body string
std::string req_body(const http::request<http::string_body>& req){
    return req.body();
}

// --------------------------------------------------------------------------
// ADR-188 (segunda pasada): autorización real por tenant sobre las rutas de
// lienzo (blocks/connections/rules), que hasta ahora no validaban que el
// `diagram_id`/`sensor_id` de la request perteneciera al tenant de quien
// llama -- mismo nivel de exposición que ya existía con 'empX_minaY' (un
// UUID de otro tenant es adivinable en teoría, aunque la UI nunca lo
// expone). Reusa GET /api/internal/resolve-session (backend principal) en
// vez de reimplementar el parseo/verificación de JWT acá.
// --------------------------------------------------------------------------

// ADR-195: el diagrama ahora es por FÓRMULA ('formula_<formula_id>'), no por
// sensor -- un sensor puede tener varias fórmulas (ALT/MCA/MPA de un mismo
// piezómetro, por ejemplo) y el esquema viejo ('sensor_<uuid>') era ambiguo
// entre ellas. Se resuelve el sensor_id real con una consulta a
// sensor_formula_def (misma BD, sensors_db) en vez de parsear un substring.
// Se conserva la rama 'sensor_<uuid>' vieja tal cual -- ADR-188 seguía
// "pendiente de verificación E2E en vivo" al momento de este cambio, así que
// no se espera diagram_id real bajo ese esquema, pero no cuesta nada dejarlo
// funcionando por compatibilidad.
std::string sensorIdFromDiagramId(pqxx::connection& db, const std::string& diagramId){
    static const std::string formulaPrefix = "formula_";
    if(diagramId.rfind(formulaPrefix, 0) == 0){
        const std::string formulaId = diagramId.substr(formulaPrefix.size());
        if(formulaId.empty()) return "";
        try{
            pqxx::work w(db);
            pqxx::result r = w.exec_params(
                "SELECT sensor_id::text FROM sensor_formula_def WHERE formula_id = $1::bigint", formulaId);
            if(r.empty() || r[0][0].is_null()) return "";
            return r[0][0].c_str();
        }catch(...){ return ""; }
    }
    static const std::string prefix = "sensor_";
    if(diagramId.rfind(prefix, 0) != 0) return "";
    const std::string rest = diagramId.substr(prefix.size());
    if(rest.size() < 36) return "";
    return rest.substr(0, 36);
}

// Llama a GET /api/internal/resolve-session en el backend principal
// (alcanzable como `web:8081` dentro de la red Docker por defecto de
// compose, sin pasar por nginx), reenviando el header Cookie de la request
// original tal cual -- esa cookie de sesión SÍ le llega intacta al sidecar
// (nginx solo pisa Authorization en /formula-api/, ver ADR-188). El segundo
// factor server-to-server (X-Internal-Token) reusa el mismo secreto
// compartido que ya usa este proceso para su propia auth de WebSocket
// (env AUTH_TOKEN == BEEMETRY_FORMULA_AUTH_TOKEN). Timeout corto (3s): si el
// backend principal no responde, se falla cerrado (unauthorized), nunca se
// asume autorizado por defecto.
std::string resolveSessionTenantId(const http::request<http::string_body>& req){
    try{
        std::string cookie;
        auto cit = req.find(http::field::cookie);
        if(cit != req.end()) cookie = std::string(cit->value());
        if(cookie.empty()) return "";

        const char* internalToken = std::getenv("AUTH_TOKEN");
        if(!internalToken || std::strlen(internalToken) == 0) return "";

        net::io_context ioc;
        tcp::resolver resolver(ioc);
        beast::tcp_stream stream(ioc);
        stream.expires_after(std::chrono::seconds(3));
        auto const results = resolver.resolve("web", "8081");
        stream.connect(results);

        http::request<http::empty_body> creq{http::verb::get, "/api/internal/resolve-session", 11};
        creq.set(http::field::host, "web");
        creq.set(http::field::user_agent, "formula-engine-internal/1.0");
        creq.set("X-Internal-Token", internalToken);
        creq.set(http::field::cookie, cookie);
        http::write(stream, creq);

        beast::flat_buffer buffer;
        http::response<http::string_body> cres;
        http::read(stream, buffer, cres);

        beast::error_code ec;
        stream.socket().shutdown(tcp::socket::shutdown_both, ec);

        if(cres.result() != http::status::ok) return "";
        json j = json::parse(cres.body());
        if(j.contains("tenant_id") && j["tenant_id"].is_string()){
            return j["tenant_id"].get<std::string>();
        }
        return "";
    }catch(...){
        return "";
    }
}

bool sensorBelongsToTenantId(pqxx::connection& db, const std::string& sensorId, const std::string& tenantId){
    if(sensorId.empty() || tenantId.empty()) return false;
    try{
        pqxx::work w(db);
        pqxx::result r = w.exec_params(
            "SELECT 1 FROM sensors WHERE sensor_id = $1::uuid AND tenant_id = $2::uuid", sensorId, tenantId);
        return !r.empty();
    }catch(...){ return false; }
}

// Autorización completa para una operación sobre un diagram_id dado: resuelve
// el tenant real de la sesión (cookie reenviada) y confirma que el sensor_id
// codificado en el diagram_id pertenece a ese tenant. Fail-closed en TODOS
// los casos ambiguos (diagram_id con formato viejo/vacío, sesión no
// resoluble, backend principal inalcanzable) -- nunca se asume autorizado.
// Al fallar, deja el código/cuerpo de error listo en `res` y devuelve false;
// el caller solo necesita `if(!authorizeDiagram(...)) { ...write res...; }`.
bool authorizeDiagram(const http::request<http::string_body>& req, pqxx::connection& db,
                      const std::string& diagramId, http::response<http::string_body>& res){
    const std::string sensorId = sensorIdFromDiagramId(db, diagramId);
    if(sensorId.empty()){
        res.result(http::status::bad_request);
        res.body() = R"({"error":"invalid_diagram_id"})";
        return false;
    }
    const std::string tenantId = resolveSessionTenantId(req);
    if(tenantId.empty()){
        res.result(http::status::unauthorized);
        res.body() = R"({"error":"unauthorized"})";
        return false;
    }
    if(!sensorBelongsToTenantId(db, sensorId, tenantId)){
        res.result(http::status::forbidden);
        res.body() = R"({"error":"sensor_not_in_tenant"})";
        return false;
    }
    return true;
}

// Variante para operaciones identificadas por un id de fila (block/connection/
// rule) que no traen diagram_id directamente en la request -- lo resuelve
// primero con la query dada (debe devolver una sola columna: diagram_id) y
// delega en authorizeDiagram. `diagramId` sin filas (id inexistente) fallará
// cerrado con 'invalid_diagram_id', consistente con "no autorizado" en vez
// de filtrar si el id existe o no.
template <typename... Args>
bool authorizeByLookup(const http::request<http::string_body>& req, pqxx::connection& db,
                       http::response<http::string_body>& res,
                       const std::string& lookupSql, Args&&... args){
    std::string diagramId;
    try{
        pqxx::work w(db);
        pqxx::result r = w.exec_params(lookupSql, std::forward<Args>(args)...);
        if(!r.empty() && !r[0][0].is_null()) diagramId = r[0][0].c_str();
    }catch(...){}
    return authorizeDiagram(req, db, diagramId, res);
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
                    if(!authorizeDiagram(req, db, diagram_id, res)){
                        res.prepare_payload(); http::write(socket, res); break;
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
                        std::string authh(it->value().data(), it->value().size());
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
                        // Si el bloque ya existe, autorizar contra SU diagram_id
                        // guardado -- no el del payload -- porque el UPDATE de
                        // abajo nunca toca esa columna (un id ya existente no
                        // puede "moverse" de diagrama). Sin esto, alguien podría
                        // pasar un diagram_id propio (autoriza) para reusar un
                        // `id` de bloque adivinado de OTRO tenant y mover/
                        // renombrar su bloque sin cambiar su diagram_id real.
                        std::string existingDiagramId;
                        {
                            pqxx::work wl(db);
                            pqxx::result rl = wl.exec_params("SELECT diagram_id FROM blocks WHERE id=$1", id);
                            if(!rl.empty() && !rl[0][0].is_null()) existingDiagramId = rl[0][0].c_str();
                        }
                        const std::string authDiagramId = existingDiagramId.empty() ? diagram_id : existingDiagramId;
                        if(!authorizeDiagram(req, db, authDiagramId, res)){
                            res.prepare_payload(); http::write(socket, res); break;
                        }
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
                    } else if(!authorizeByLookup(req, db, res,
                            "SELECT diagram_id FROM blocks WHERE id=$1", id)){
                        res.prepare_payload(); http::write(socket, res); break;
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
                    } else if(!authorizeDiagram(req, db, p.value("diagram_id", ""), res)){
                        res.prepare_payload(); http::write(socket, res); break;
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
                    } else if(!authorizeByLookup(req, db, res,
                            "SELECT diagram_id FROM connections WHERE id=$1", cid)){
                        res.prepare_payload(); http::write(socket, res); break;
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
                    } else if(!authorizeByLookup(req, db, res,
                            "SELECT diagram_id FROM connections WHERE id=$1", cid)){
                        res.prepare_payload(); http::write(socket, res); break;
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
                    pqxx::result rr;
                    if(block_id.empty()){
                        // Sin block_id: listaría TODAS las reglas de TODOS los
                        // tenants (comportamiento previo). Ahora se resuelve
                        // el tenant real y se filtra por él (join a través de
                        // blocks.diagram_id -> sensor_id -> sensors.tenant_id)
                        // en vez de listar todo sin distinción.
                        const std::string tenantId = resolveSessionTenantId(req);
                        if(tenantId.empty()){
                            res.result(http::status::unauthorized);
                            res.body() = R"({"error":"unauthorized"})";
                            res.prepare_payload(); http::write(socket, res); break;
                        }
                        pqxx::work w(db);
                        // ADR-195: b.diagram_id puede venir en dos esquemas --
                        // 'formula_<formula_id>' (nuevo, resuelto vía
                        // sensor_formula_def) o 'sensor_<uuid>' (viejo, el
                        // sensor_id son los 36 chars tras el prefijo).
                        rr = w.exec_params(
                            "SELECT r.id, r.block_id, r.expr FROM rules r "
                            "JOIN blocks b ON b.id = r.block_id "
                            "JOIN sensors s ON s.sensor_id::text = ( "
                            "  CASE "
                            "    WHEN b.diagram_id LIKE 'formula\\_%' ESCAPE '\\' THEN ( "
                            "      SELECT f.sensor_id::text FROM sensor_formula_def f "
                            "      WHERE f.formula_id::text = substring(b.diagram_id from 9) "
                            "    ) "
                            "    WHEN b.diagram_id LIKE 'sensor\\_%' ESCAPE '\\' THEN substring(b.diagram_id from 8 for 36) "
                            "    ELSE NULL "
                            "  END "
                            ") "
                            "WHERE s.tenant_id = $1::uuid ORDER BY r.id", tenantId);
                    } else {
                        if(!authorizeByLookup(req, db, res,
                                "SELECT diagram_id FROM blocks WHERE id=$1", block_id)){
                            res.prepare_payload(); http::write(socket, res); break;
                        }
                        pqxx::work w(db);
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
                    const bool isUpdate = p.contains("id") && !p["id"].is_null() && p["id"].is_number();
                    if(block_id.empty() || expr.empty()){
                        res.result(http::status::bad_request);
                        res.body() = R"({"error":"block_id and expr required"})";
                    } else if(!authorizeByLookup(req, db, res,
                            "SELECT diagram_id FROM blocks WHERE id=$1", block_id)){
                        // Autoriza el block_id NUEVO/destino (payload) -- cubre
                        // el caso de creación y de reasignar una regla a un
                        // bloque propio.
                        res.prepare_payload(); http::write(socket, res); break;
                    } else if(isUpdate && !authorizeByLookup(req, db, res,
                            "SELECT b.diagram_id FROM rules r JOIN blocks b ON b.id = r.block_id WHERE r.id=$1",
                            p.value("id", 0))){
                        // En UPDATE, autoriza TAMBIÉN el bloque ORIGINAL de la
                        // regla que se está por sobreescribir -- sin esto, un
                        // `id` de regla ajeno adivinado + un block_id propio
                        // en el payload hubiera permitido secuestrar/reasignar
                        // la fila de otro tenant (la autorización de arriba
                        // sola solo mira el destino, no el dueño actual).
                        res.prepare_payload(); http::write(socket, res); break;
                    } else {
                        json meta = read_meta_object(p);
                        pqxx::work t(db);
                        int rule_id = 0;
                        if(isUpdate){
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
                    } else if(!authorizeByLookup(req, db, res,
                            "SELECT b.diagram_id FROM rules r JOIN blocks b ON b.id = r.block_id WHERE r.id=$1", rid)){
                        res.prepare_payload(); http::write(socket, res); break;
                    } else {
                        pqxx::work t(db);
                        t.exec_params("DELETE FROM rules WHERE id = $1", rid);
                        t.commit();
                        res.body() = R"({"ok":true})";
                    }
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

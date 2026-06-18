const fs = require('fs');

const sql = [];

// Table for KPIs
sql.push("DROP TABLE IF EXISTS dashboard_kpis;");
sql.push("CREATE TABLE dashboard_kpis (id SERIAL PRIMARY KEY, name VARCHAR(50), value NUMERIC, unit VARCHAR(20), trend VARCHAR(20), trend_value NUMERIC);");
sql.push("INSERT INTO dashboard_kpis (name, value, unit, trend, trend_value) VALUES");
sql.push("  ('production', 14500, 'tpd', 'up', 5.2),");
sql.push("  ('copper_grade', 1.85, '%', 'up', 0.15),");
sql.push("  ('oee', 87.5, '%', 'up', 2.1),");
sql.push("  ('safety_incidents', 0, 'days', 'neutral', 45);");

// Table for Heatmap
sql.push("DROP TABLE IF EXISTS dashboard_heatmap;");
sql.push("CREATE TABLE dashboard_heatmap (id SERIAL PRIMARY KEY, day INTEGER, level_name VARCHAR(20), x_coord INTEGER, y_coord INTEGER, intensity NUMERIC);");

// Generate heatmap data
const levels = Array.from({length: 9}, (_, i) => `Nv. ${3800 + i * 50}`);

const values = [];
const center_x = 50;
const center_y = 50;

function gauss(mean, stdev) {
    let u = 1 - Math.random(); // Converting [0,1) to (0,1]
    let v = Math.random();
    let z = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    // Transform to the desired mean and standard deviation:
    return z * stdev + mean;
}

for (let day = 1; day <= 15; day++) {
    for (let l_idx = 0; l_idx < levels.length; l_idx++) {
        const level = levels[l_idx];
        const num_points = Math.floor(Math.random() * 8) + 3 + Math.floor(day * 1.5);
        for (let i = 0; i < num_points; i++) {
            let x = Math.max(0, Math.min(100, Math.floor(gauss(center_x, 25))));
            let y = Math.max(0, Math.min(100, Math.floor(gauss(center_y, 25))));
            let val = Math.round(Math.min(1.0, Math.max(0.1, Math.random() * (0.3 + (day / 15.0) * 0.7))) * 100) / 100;

            if (Math.random() > 0.6) {
                const progression = day / 15.0;
                const fault_x = Math.floor(20 + progression * 60);
                const fault_y = Math.floor(30 + progression * 50);
                
                if (Math.abs(l_idx - 4) < 3) {
                    x = Math.max(0, Math.min(100, Math.floor(gauss(fault_x, 10))));
                    y = Math.max(0, Math.min(100, Math.floor(gauss(fault_y, 10))));
                    val = Math.round(Math.min(1.0, val + 0.4) * 100) / 100;
                }
            }
            values.push(`(${day}, '${level}', ${x}, ${y}, ${val})`);
        }
    }
}

// Batch inserts
const chunk_size = 500;
for (let i = 0; i < values.length; i += chunk_size) {
    const chunk = values.slice(i, i + chunk_size);
    sql.push("INSERT INTO dashboard_heatmap (day, level_name, x_coord, y_coord, intensity) VALUES");
    sql.push(`  ${chunk.join(',')};`);
}

fs.writeFileSync('c:\\InformeCliente\\dashboard.sql', sql.join('\n'));
console.log(`Generated dashboard.sql with ${values.length} points.`);

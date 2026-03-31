import random
from datetime import datetime, timedelta

sql = []

# --- Existing Tables ---
sql.append("DROP TABLE IF EXISTS dashboard_kpis;")
sql.append("CREATE TABLE dashboard_kpis (id SERIAL PRIMARY KEY, name VARCHAR(50), value NUMERIC, unit VARCHAR(20), trend VARCHAR(20), trend_value NUMERIC);")
sql.append("INSERT INTO dashboard_kpis (name, value, unit, trend, trend_value) VALUES")
sql.append("  ('production', 14500, 'tpd', 'up', 5.2),")
sql.append("  ('copper_grade', 1.85, '%', 'up', 0.15),")
sql.append("  ('oee', 87.5, '%', 'up', 2.1),")
sql.append("  ('safety_incidents', 0, 'days', 'neutral', 45);")

sql.append("DROP TABLE IF EXISTS dashboard_heatmap;")
sql.append("CREATE TABLE dashboard_heatmap (id SERIAL PRIMARY KEY, day INTEGER, level_name VARCHAR(20), x_coord INTEGER, y_coord INTEGER, intensity NUMERIC);")

levels = [f"Nv. {3800 + i * 50}" for i in range(9)]
values = []
for day in range(1, 16):
    for l_idx, level in enumerate(levels):
        for _ in range(random.randint(5, 15)):
            x, y = random.randint(0, 100), random.randint(0, 100)
            val = round(random.random(), 2)
            values.append(f"({day}, '{level}', {x}, {y}, {val})")

for i in range(0, len(values), 500):
    chunk = values[i:i+500]
    sql.append("INSERT INTO dashboard_heatmap (day, level_name, x_coord, y_coord, intensity) VALUES " + ",".join(chunk) + ";")

sql.append("DROP TABLE IF EXISTS surveillance_cameras;")
sql.append("CREATE TABLE surveillance_cameras (id SERIAL PRIMARY KEY, name VARCHAR(100), location VARCHAR(100), rtmp_url VARCHAR(255), status VARCHAR(20), lat NUMERIC, lng NUMERIC);")
sql.append("INSERT INTO surveillance_cameras (name, location, rtmp_url, status, lat, lng) VALUES ('Cam 01', 'Tajo', '', 'online', -17.245, -70.61);")

sql.append("DROP TABLE IF EXISTS map_markers;")
sql.append("CREATE TABLE map_markers (id SERIAL PRIMARY KEY, type VARCHAR(50), lat NUMERIC, lng NUMERIC, name VARCHAR(100), status VARCHAR(20));")
sql.append("INSERT INTO map_markers (type, lat, lng, name, status) VALUES ('sensor', -17.245, -70.61, 'Inclinometer 01', 'active');")

# --- New Advanced Sensor Tables ---
sql.append("DROP TABLE IF EXISTS mining_sensor_history CASCADE;")
sql.append("DROP TABLE IF EXISTS mining_sensors CASCADE;")
sql.append("DROP TABLE IF EXISTS mining_sensor_types CASCADE;")
sql.append("DROP TABLE IF EXISTS mining_sensor_categories CASCADE;")

sql.append("CREATE TABLE mining_sensor_categories (id SERIAL PRIMARY KEY, name VARCHAR(100), description TEXT);")
sql.append("CREATE TABLE mining_sensor_types (id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES mining_sensor_categories(id), name VARCHAR(100), unit VARCHAR(20));")
sql.append("CREATE TABLE mining_sensors (id SERIAL PRIMARY KEY, type_id INTEGER REFERENCES mining_sensor_types(id), name VARCHAR(100), lat NUMERIC, lng NUMERIC, status VARCHAR(20), current_value NUMERIC);")
sql.append("CREATE TABLE mining_sensor_history (id SERIAL PRIMARY KEY, sensor_id INTEGER REFERENCES mining_sensors(id), value NUMERIC, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP);")

# Categories
sql.append("INSERT INTO mining_sensor_categories (name, description) VALUES " 
           "('Geotécnico', 'Estabilidad de taludes y túneles'),"
           "('Geoespacial', 'Monitoreo de movimiento de terreno'),"
           "('Hidrológico', 'Gestión de agua y relaves'),"
           "('Ambiental', 'Cumplimiento normativo y clima'),"
           "('Procesos', 'Monitoreo de planta concentradora');")

# Types
types = [
    (1, 'Piezómetro', 'kPa'), (1, 'Inclinómetro', 'deg'), (1, 'Extensómetro', 'mm'),
    (2, 'Radar de Taludes', 'mm/h'), (2, 'GPS Geodésico', 'mm'),
    (3, 'Nivel de Relaves', 'm'), (3, 'Sensor de pH', 'pH'), (3, 'Caudalímetro', 'm3/h'),
    (4, 'Partículas PM10', 'ug/m3'), (4, 'Gas CO2', 'ppm'), (4, 'Estación Met.', 'C'),
    (5, 'Vibración Molino', 'mm/s'), (5, 'Presión Tubería', 'psi')
]
for cat_id, name, unit in types:
    sql.append(f"INSERT INTO mining_sensor_types (category_id, name, unit) VALUES ({cat_id}, '{name}', '{unit}');")

# Sensors and History (Last 15 days)
sensor_id = 1
import math

for type_idx, (cat_id, type_name, unit) in enumerate(types):
    for i in range(1, 4): # 3 sensors per type
        name = f"{type_name} {i:02d}"
        lat = -17.246 + (random.random() - 0.5) * 0.01
        lng = -70.612 + (random.random() - 0.5) * 0.01
        
        # Base value selection based on sensor type
        if unit == 'pH': base_val = 7.0
        elif unit == 'deg': base_val = 0.0
        elif unit == 'kPa': base_val = 200.0
        elif unit == 'm': base_val = 15.0
        else: base_val = 50.0
        
        status = 'active'
        sql.append(f"INSERT INTO mining_sensors (id, type_id, name, lat, lng, status, current_value) VALUES ({sensor_id}, {type_idx + 1}, '{name}', {lat}, {lng}, '{status}', {base_val});")
        
        # History (Granular: Hourly for 15 days)
        now = datetime.now()
        history_points = []
        current_walk_val = base_val
        
        for h_offset in range(15 * 24):
            ts = (now - timedelta(hours=h_offset)).strftime('%Y-%m-%d %H:%M:%S')
            
            # Model selection based on sensor characteristics
            if unit in ['C', 'kPa', 'ug/m3']: # Cyclic/Atmospheric
                # Sinusoidal Trend (Daily cycle)
                hour_of_day = (now - timedelta(hours=h_offset)).hour
                cycle = math.sin((hour_of_day - 6) * math.pi / 12) # Peaks at 12pm, lows at 12am
                noise = (random.random() - 0.5) * (base_val * 0.05)
                val = base_val + (cycle * base_val * 0.1) + noise
            elif unit in ['mm', 'deg', 'm']: # Cumulative/Structural
                # Random Walk with slight drift (Deformation)
                drift = 0.01 if random.random() > 0.4 else -0.005
                current_walk_val += drift + (random.random() - 0.5) * 0.05
                val = current_walk_val
            else: # Steady with noise
                noise = (random.random() - 0.5) * (base_val * 0.02)
                val = base_val + noise
                
            # Anomalous Spikes (0.5% probability)
            if random.random() < 0.005:
                val *= 1.5 if random.random() > 0.5 else 0.5
                
            history_points.append(f"({sensor_id}, {round(val, 3)}, '{ts}')")
        
        # Insert history in chunks to prevent huge SQL statements
        for j in range(0, len(history_points), 500):
            chunk = history_points[j:j+500]
            sql.append("INSERT INTO mining_sensor_history (sensor_id, value, timestamp) VALUES " + ",".join(chunk) + ";")
        
        sensor_id += 1

with open('dashboard.sql', 'w', encoding='utf-8') as f:
    f.write("\n".join(sql))

print("Generated dashboard.sql with advanced sensors and history.")

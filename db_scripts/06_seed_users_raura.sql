-- Seed data for Minera Raura users
-- Company: Minera Raura
-- These are demo users for testing user maintenance and report filters
--
-- Password hashes MUST match backend hashPassword(): std::hash(salt + "::" + password) as hex,
-- default salt AUTH_PASSWORD_SALT / mining_local_salt_change_me (see main.cpp).
-- Demo1234! -> b03bc61f5c8ab388 | admin123 -> 79312d62b1fbdf39 (Ubuntu 24.04 / libstdc++)

INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, is_active, face_template)
VALUES 
  -- Administrators
  ('Minera Raura', 'Carlos', 'Mendoza', '12345678901', 'carlos_admin', 'admin', 'b03bc61f5c8ab388', true, '[]'::jsonb),
  ('Minera Raura', 'Bastian', 'Admin', '12345678908', 'bastian_admin', 'admin', '79312d62b1fbdf39', true, '[]'::jsonb),
  
  -- Supervisors/Managers
  ('Minera Raura', 'María', 'García', '12345678902', 'maria_supervisor', 'supervisor', 'b03bc61f5c8ab388', true, '[]'::jsonb),
  ('Minera Raura', 'Juan', 'Pérez', '12345678903', 'juan_supervisor', 'supervisor', 'b03bc61f5c8ab388', true, '[]'::jsonb),
  
  -- Operators
  ('Minera Raura', 'Roberto', 'Flores', '12345678904', 'op_raura', 'operator', 'b03bc61f5c8ab388', true, '[]'::jsonb),
  ('Minera Raura', 'Miguel', 'Vargas', '12345678905', 'op_vargas', 'operator', 'b03bc61f5c8ab388', true, '[]'::jsonb),
  ('Minera Raura', 'Patricia', 'Sánchez', '12345678906', 'op_patricia', 'operator', 'b03bc61f5c8ab388', true, '[]'::jsonb),
  ('Minera Raura', 'David', 'López', '12345678907', 'op_david', 'operator', 'b03bc61f5c8ab388', true, '[]'::jsonb)
ON CONFLICT (dni) DO NOTHING;

-- Log the insertion
SELECT 'Users seeded for Minera Raura' as result;

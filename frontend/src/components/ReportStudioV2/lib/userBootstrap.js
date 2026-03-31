/**
 * userBootstrap.js
 * Bootstrap users from backend API to localStorage
 * Called on app initialization to sync company users
 */

const USERS_KEY = 'mining_auth_users_v1';
const LAST_SYNC = 'mining_users_last_sync_v1';
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function getAuthApi() {
  return import('../../../auth/authApi');
}

function getLastSyncTime() {
  try {
    const raw = localStorage.getItem(LAST_SYNC);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function setLastSyncTime(timestamp) {
  try {
    localStorage.setItem(LAST_SYNC, String(timestamp));
  } catch {
    // ignore
  }
}

function getStoredUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setStoredUsers(users) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch {
    // ignore
  }
}

/**
 * Create demo/seed users for a company if they don't exist
 */
function createSeedUsers(company) {
  const existing = getStoredUsers();
  const companyExists = existing.some((u) => (u.company || '') === company);
  if (companyExists) return existing;

  const seedUsers = [
    {
      id: `seed_${company}_1`,
      username: 'carlos_admin',
      first_name: 'Carlos',
      last_name: 'Mendoza',
      dni: '12345678901',
      company,
      role: 'admin',
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: `seed_${company}_2`,
      username: 'maria_supervisor',
      first_name: 'María',
      last_name: 'García',
      dni: '12345678902',
      company,
      role: 'supervisor',
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: `seed_${company}_3`,
      username: 'juan_supervisor',
      first_name: 'Juan',
      last_name: 'Pérez',
      dni: '12345678903',
      company,
      role: 'supervisor',
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: `seed_${company}_4`,
      username: 'op_raura',
      first_name: 'Roberto',
      last_name: 'Flores',
      dni: '12345678904',
      company,
      role: 'operator',
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: `seed_${company}_5`,
      username: 'op_vargas',
      first_name: 'Miguel',
      last_name: 'Vargas',
      dni: '12345678905',
      company,
      role: 'operator',
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: `seed_${company}_6`,
      username: 'op_patricia',
      first_name: 'Patricia',
      last_name: 'Sánchez',
      dni: '12345678906',
      company,
      role: 'operator',
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: `seed_${company}_7`,
      username: 'op_david',
      first_name: 'David',
      last_name: 'López',
      dni: '12345678907',
      company,
      role: 'operator',
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ];

  return [...existing, ...seedUsers];
}

/**
 * Bootstrap users from backend API with fallback to seed data
 */
export async function bootstrapUsers(company) {
  if (!company) return;

  // Check if we should sync
  const now = Date.now();
  const lastSync = getLastSyncTime();
  if (now - lastSync < SYNC_INTERVAL) {
    return; // Already synced recently
  }

  try {
    const api = await getAuthApi();
    const result = await api.fetchCompanyUsers(company);
    const users = Array.isArray(result?.users) ? result.users : [];

    if (users.length > 0) {
      // Got users from backend
      const existing = getStoredUsers().filter((u) => (u.company || '') !== company);
      setStoredUsers([...existing, ...users.map((u) => ({
        ...u,
        company: u.company || u.company_name || company,
      }))]);
      setLastSyncTime(now);
      return;
    }
  } catch (err) {
    console.debug('Failed to fetch users from backend, using seed data:', err.message);
  }

  // Fallback: create seed users
  const users = createSeedUsers(company);
  setStoredUsers(users);
  setLastSyncTime(now);
}

/**
 * Force refresh users from backend
 */
export async function refreshUsers(company) {
  if (!company) return;

  try {
    const api = await getAuthApi();
    const result = await api.fetchCompanyUsers(company);
    const users = Array.isArray(result?.users) ? result.users : [];

    if (users.length > 0) {
      const existing = getStoredUsers().filter((u) => (u.company || '') !== company);
      setStoredUsers([...existing, ...users.map((u) => ({
        ...u,
        company: u.company || u.company_name || company,
      }))]);
      setLastSyncTime(Date.now());
      return true;
    }
  } catch (err) {
    console.debug('Failed to refresh users:', err.message);
  }

  return false;
}

/**
 * Check if users exist for company, if not create seed users
 */
export function ensureCompanyUsers(company) {
  if (!company) return;

  const existing = getStoredUsers();
  const companyHasUsers = existing.some((u) => (u.company || '') === company);
  
  if (!companyHasUsers) {
    const users = createSeedUsers(company);
    setStoredUsers(users);
  }
}

// Google Sheets API client for AVN Game Tracker

export function getApiUrl() {
  return import.meta.env.VITE_GOOGLE_SHEETS_API_URL || localStorage.getItem('AVN_GS_API_URL') || 'https://script.google.com/macros/s/AKfycbxB-2jjr9I0GDUk50ROdu_eG6MSpP8dMxSAeg9ZsWXFGvDcK3XsEIxHlnBgBAOIs6myLw/exec';
}

export function setApiUrl(url) {
  if (url) {
    localStorage.setItem('AVN_GS_API_URL', url.trim());
  } else {
    localStorage.removeItem('AVN_GS_API_URL');
  }
}

export function isConfigured() {
  return !!getApiUrl();
}

async function apiCall(action, data = {}, method = 'POST') {
  const url = getApiUrl();
  if (!url) {
    throw new Error('ยังไม่ได้ตั้งค่า Google Sheets API URL ในระบบ');
  }

  try {
    if (method === 'GET') {
      const queryParams = new URLSearchParams({ action, ...data }).toString();
      const response = await fetch(`${url}?${queryParams}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      if (result.status === 'error') {
        throw new Error(result.message || 'เกิดข้อผิดพลาดในการดึงข้อมูล');
      }
      return result;
    } else {
      // POST requests
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({ action, ...data })
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      if (result.status === 'error') {
        throw new Error(result.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
      }
      return result;
    }
  } catch (error) {
    console.error(`Google Sheets API Error [action=${action}]:`, error);
    throw new Error(error.message || 'ไม่สามารถเชื่อมต่อกับฐานข้อมูล Google Sheets ได้', { cause: error });
  }
}

// User Authentication
export async function registerUser(username, email, password) {
  const res = await apiCall('register', { username, email, password });
  return res.data; // { username, email, role, signupDate, expiryDate }
}

export async function loginUser(username, password) {
  const res = await apiCall('login', { username, password });
  return res.data; // { username, email, role, signupDate, expiryDate }
}

export async function requestPasswordReset(email) {
  const res = await apiCall('forgotPasswordRequest', { email });
  return res; // { status, message }
}

export async function resetPassword(email, otp, newPassword) {
  const res = await apiCall('forgotPasswordVerify', { email, otp, newPassword });
  return res; // { status, message }
}

export async function updateUserRole(email, role, signupDate, expiryDate) {
  return await apiCall('updateUserRole', { email, role, signupDate, expiryDate });
}

export async function getUsersList() {
  const res = await apiCall('getUsersList', {}, 'GET');
  return res.data || [];
}

export async function deleteUser(email) {
  return await apiCall('deleteUser', { email });
}

// User Library Management
export async function getUserLibrary(email) {
  const res = await apiCall('getUserLibrary', { email });
  const list = res.data || [];
  return list.map(g => ({
    email: g.email || "",
    gameId: g.gameId || g.gameid || "",
    status: g.status || "วางแผนจะเล่น",
    notes: g.notes || "",
    playTime: parseFloat(g.playTime) || parseFloat(g.playtime) || 0,
    rating: parseFloat(g.rating) || 5.0,
    isCustom: g.isCustom === true || g.iscustom === "true" || g.iscustom === true,
    title: g.title || "",
    developer: g.developer || "",
    version: g.version || "",
    coverUrl: g.coverUrl || g.coverurl || "",
    overview: g.overview || "",
    patreonUrl: g.patreonUrl || g.patreonurl || "",
    buyUrl: g.buyUrl || g.buyurl || "",
    socialUrl: g.socialUrl || g.socialurl || "",
    screenshots: Array.isArray(g.screenshots) ? g.screenshots : (g.screenshots ? JSON.parse(g.screenshots) : []),
    updatedAt: g.updatedAt || g.updatedat || ""
  }));
}

export async function updateLibraryItem(email, item) {
  return await apiCall('updateLibraryItem', { email, item });
}

export async function deleteLibraryItem(email, gameId) {
  return await apiCall('deleteLibraryItem', { email, gameId });
}

export async function getAllUserLibraries() {
  const res = await apiCall('getAllLibraries', {}, 'GET');
  return res.data || [];
}

// Catalog (Official Games) Management
export async function getOfficialGames() {
  const res = await apiCall('getOfficialGames', {}, 'GET');
  const list = res.data || [];
  return list.map(g => ({
    id: g.id || "",
    title: g.title || "",
    developer: g.developer || "",
    version: g.version || "",
    overview: g.overview || "",
    coverUrl: g.coverUrl || g.coverurl || "",
    patreonUrl: g.patreonUrl || g.patreonurl || "",
    buyUrl: g.buyUrl || g.buyurl || "",
    socialUrl: g.socialUrl || g.socialurl || "",
    rating: parseFloat(g.rating) || 5.0,
    tags: Array.isArray(g.tags) ? g.tags : (g.tags ? g.tags.split(',').map(t => t.trim()) : []),
    screenshots: Array.isArray(g.screenshots) ? g.screenshots : (g.screenshots ? JSON.parse(g.screenshots) : []),
    updatedAt: g.updatedAt || g.updatedat || "",
    isCustom: false
  }));
}

export async function saveOfficialGame(game) {
  return await apiCall('saveOfficialGame', { game });
}

export async function deleteOfficialGame(gameId) {
  return await apiCall('deleteOfficialGame', { gameId });
}

// System Configurations
export async function getSystemConfig() {
  const res = await apiCall('getConfig', {}, 'GET');
  return res.data || {};
}

export async function saveSystemConfig(config) {
  return await apiCall('saveConfig', { config });
}

// Transaction Management
export async function getTransactions() {
  const res = await apiCall('getTransactions', {}, 'GET');
  const list = res.data || [];
  return list.map(tx => ({
    id: tx.id || "",
    email: tx.email || "",
    username: tx.username || "",
    amount: parseFloat(tx.amount) || 0,
    packageName: tx.packageName || tx.packagename || "",
    timestamp: tx.timestamp || "",
    status: tx.status || "",
    slipUrl: tx.slipUrl || tx.slipurl || "",
    refNo: tx.refNo || tx.refno || "",
    reason: tx.reason || "",
    updatedAt: tx.updatedAt || tx.updatedat || ""
  }));
}

export async function saveTransaction(tx) {
  return await apiCall('saveTransaction', { tx });
}

// Reports and Suggestions
export async function submitReport(report) {
  return await apiCall('submitReport', { report });
}

export async function getReports() {
  const res = await apiCall('getReports', {}, 'GET');
  const list = res.data || [];
  return list.map(r => ({
    id: r.id || "",
    email: r.email || "",
    type: r.type || "",
    gameTitle: r.gameTitle || r.gametitle || "",
    reportedVersion: r.reportedVersion || r.reportedversion || "",
    description: r.description || "",
    changelog: r.changelog || "",
    developerUrl: r.developerUrl || r.developerurl || "",
    reportTags: r.reportTags || r.reporttags || "",
    errorStatus: r.errorStatus || r.errorstatus || "",
    timestamp: r.timestamp || "",
    status: r.status || ""
  }));
}

export async function updateReportStatus(reportId, status) {
  return await apiCall('updateReportStatus', { reportId, status });
}

export async function testConnection() {
  try {
    const res = await apiCall('checkInit', {}, 'GET');
    return res.status === 'ok';
  } catch (err) {
    console.error('Connection test error:', err);
    return false;
  }
}

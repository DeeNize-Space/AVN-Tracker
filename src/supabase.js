import { createClient } from '@supabase/supabase-js';

// Read values from Vite environment variables or localStorage fallback
// The user can configure the URL and Anon Key inside their browser Admin Panel if they want to override.
export const SUPABASE_URL = localStorage.getItem('AVN_SB_URL') || import.meta.env.VITE_SUPABASE_URL || 'https://hncuodecqujgjgduqbny.supabase.co';
export const SUPABASE_ANON_KEY = localStorage.getItem('AVN_SB_ANON_KEY') || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function getApiUrl() {
  return SUPABASE_URL;
}

export function setApiUrl(url, key = '') {
  if (url) {
    localStorage.setItem('AVN_SB_URL', url.trim());
  } else {
    localStorage.removeItem('AVN_SB_URL');
  }
  if (key) {
    localStorage.setItem('AVN_SB_ANON_KEY', key.trim());
  } else {
    localStorage.removeItem('AVN_SB_ANON_KEY');
  }
}

export function isConfigured() {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

// ==========================================
// USER AUTHENTICATION
// ==========================================

export async function registerUser(username, email, password) {
  const { error } = await supabase.auth.signUp({
    email: email.trim(),
    password: password,
    options: {
      data: {
        username: username.trim()
      }
    }
  });

  if (error) throw error;

  // Supabase sends confirmation email if enabled. Let's return profile
  // For instant UX, we return mock details or fetch profile
  return {
    email: email.trim().toLowerCase(),
    username: username.trim(),
    role: 'user',
    signupDate: new Date().toISOString().split('T')[0],
    expiryDate: ''
  };
}

export async function loginUser(usernameOrEmail, password) {
  let email = usernameOrEmail.trim();

  // If input is username instead of email, we query public.profiles to find email
  if (usernameOrEmail.indexOf('@') === -1) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('username', usernameOrEmail.trim())
      .maybeSingle();

    if (profile && profile.email) {
      email = profile.email;
    }
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) throw error;

  // Fetch profiles table for user role & subscription details
  const { data: profile, error: errProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (errProfile) throw errProfile;

  let mappedRole = 'user';
  if (profile.admin === 'yes') {
    mappedRole = 'admin';
  } else if (profile.premium === 'yes') {
    mappedRole = 'premium';
  }

  return {
    username: profile.username || usernameOrEmail,
    email: profile.email,
    role: mappedRole,
    signupDate: profile.signup_date || '',
    expiryDate: profile.expiry_date || ''
  };
}

export async function loginWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
  if (error) throw error;
}

export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return null;

  // Fetch profiles table for user role & subscription details
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  let mappedRole = 'user';
  if (profile) {
    if (profile.admin === 'yes') {
      mappedRole = 'admin';
    } else if (profile.premium === 'yes') {
      mappedRole = 'premium';
    }
  }

  return {
    username: profile?.username || session.user.user_metadata?.full_name || session.user.email.split('@')[0],
    email: session.user.email,
    role: mappedRole,
    signupDate: profile?.signup_date || '',
    expiryDate: profile?.expiry_date || ''
  };
}

export async function logoutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  return { status: 'success' };
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin
  });

  if (error) throw error;
  return { status: 'success', message: 'ลิ้งก์ตั้งค่ารหัสผ่านใหม่ถูกส่งไปที่อีเมลของคุณแล้ว' };
}

export async function resetPassword(email, otp, newPassword) {
  // Supabase reset password flow usually involves confirming otp or token
  // If the user gets a token/OTP from email, we verify it first:
  const { error: otpError } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: otp.trim(),
    type: 'recovery'
  });

  if (otpError) throw otpError;

  // Now update password
  const { error } = await supabase.auth.updateUser({
    password: newPassword
  });

  if (error) throw error;
  return { status: 'success', message: 'แก้ไขรหัสผ่านใหม่เรียบร้อยแล้ว' };
}

export async function updateUserRole(email, role, signupDate, expiryDate) {
  // Determine premium & admin values
  const premium = (role === 'admin' || role === 'premium') ? 'yes' : 'no';
  const admin = role === 'admin' ? 'yes' : 'no';

  const updatePayload = {
    premium,
    admin
  };
  if (signupDate !== undefined) updatePayload.signup_date = signupDate || null;
  if (expiryDate !== undefined) updatePayload.expiry_date = expiryDate || null;

  const { error } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('email', email.trim().toLowerCase());

  if (error) throw error;
  return { status: 'success' };
}

export async function getUsersList() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return data.map(p => {
    let mappedRole = 'user';
    if (p.admin === 'yes') {
      mappedRole = 'admin';
    } else if (p.premium === 'yes') {
      mappedRole = 'premium';
    }

    return {
      username: p.username || '',
      email: p.email || '',
      role: mappedRole,
      signupDate: p.signup_date || '',
      expiryDate: p.expiry_date || ''
    };
  });
}

export async function deleteUser(email) {
  // We delete from public.profiles; auth trigger can delete from auth.users (if configured)
  // Or we call standard delete profile
  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('email', email.trim().toLowerCase());

  if (error) throw error;
  return { status: 'success' };
}

// ==========================================
// USER LIBRARY MANAGEMENT
// ==========================================

export async function getUserLibrary(email) {
  // Find user_id from email first
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();

  if (!profile) return [];

  const { data, error } = await supabase
    .from('library')
    .select('library_data')
    .eq('user_id', profile.id)
    .maybeSingle();

  if (error) throw error;
  if (!data || !data.library_data) return [];

  return data.library_data;
}

export async function saveUserLibrary(email, items) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .single();

  const payload = {
    user_id: profile.id,
    email: email.trim().toLowerCase(),
    library_data: items || [],
    last_updated: new Date().toISOString()
  };

  const { error } = await supabase
    .from('library')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    alert(`Supabase Save Error: ${error.message} \nDetails: ${JSON.stringify(error)}`);
    throw error;
  }
  return { status: 'success' };
}

export async function getAllUserLibraries() {
  const { data, error } = await supabase
    .from('library')
    .select('email, library_data');

  if (error) throw error;

  return data.map(row => ({
    email: row.email || '',
    librarydata: JSON.stringify(row.library_data || [])
  }));
}

export async function incrementGameViewCount(gameId) {
  // Standard increment on Postgres
  const { error } = await supabase.rpc('increment_view_count', { game_id: gameId });
  
  if (error) {
    // Fallback: manually update
    const { data: game } = await supabase
      .from('official_games')
      .select('view_count')
      .eq('id', gameId)
      .single();

    if (game) {
      await supabase
        .from('official_games')
        .update({ view_count: (game.view_count || 0) + 1 })
        .eq('id', gameId);
    }
  }
  return { status: 'success' };
}

// ==========================================
// CATALOG (OFFICIAL GAMES) MANAGEMENT
// ==========================================

export async function getOfficialGames() {
  const { data, error } = await supabase
    .from('official_games')
    .select('*')
    .order('title', { ascending: true });

  if (error) throw error;

  return data.map(g => ({
    id: g.id || '',
    title: g.title || '',
    developer: g.developer || '',
    version: g.version || '',
    overview: g.overview || '',
    coverUrl: g.cover_url || '',
    patreonUrl: g.patreon_url || '',
    buyUrl: g.buy_url || '',
    socialUrl: g.social_url || '',
    rating: parseFloat(g.rating) || 5.0,
    tags: g.tags || [],
    screenshots: g.screenshots || [],
    viewCount: g.view_count || 0,
    createdAt: g.created_at || '',
    updatedAt: g.updated_at || '',
    isCustom: false
  }));
}

export async function saveOfficialGame(game) {
  const payload = {
    id: game.id,
    title: game.title,
    developer: game.developer,
    version: game.version,
    overview: game.overview || '',
    cover_url: game.coverUrl || '',
    patreon_url: game.patreonUrl || '',
    buy_url: game.buyUrl || '',
    social_url: game.socialUrl || '',
    rating: parseFloat(game.rating) || 5.0,
    tags: game.tags || [],
    screenshots: game.screenshots || [],
    view_count: game.viewCount || 0,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('official_games')
    .upsert(payload);

  if (error) throw error;
  return { status: 'success' };
}

export async function deleteOfficialGame(gameId) {
  const { error } = await supabase
    .from('official_games')
    .delete()
    .eq('id', gameId);

  if (error) throw error;
  return { status: 'success' };
}

// ==========================================
// SYSTEM CONFIGURATIONS
// ==========================================

export async function getSystemConfig() {
  const { data, error } = await supabase
    .from('config')
    .select('*');

  if (error) throw error;

  const config = {};
  data.forEach(row => {
    config[row.key] = row.value;
  });
  return config;
}

export async function saveSystemConfig(config) {
  const rows = Object.keys(config).map(k => ({
    key: k,
    value: config[k] !== undefined ? String(config[k]) : ''
  }));

  const { error } = await supabase
    .from('config')
    .upsert(rows);

  if (error) throw error;
  return { status: 'success' };
}

// ==========================================
// TRANSACTION MANAGEMENT
// ==========================================

export async function getTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return data.map(tx => ({
    id: tx.id || '',
    email: tx.email || '',
    username: tx.username || '',
    amount: parseFloat(tx.amount) || 0,
    packageName: tx.package_name || '',
    timestamp: tx.created_at || '',
    status: tx.status || 'pending',
    slipUrl: tx.slip_url || '',
    refNo: tx.ref_no || '',
    reason: tx.reason || '',
    updatedAt: tx.updated_at || ''
  }));
}

export async function saveTransaction(tx) {
  // Find user_id from email if possible
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', tx.email.trim().toLowerCase())
    .maybeSingle();

  const payload = {
    id: tx.id,
    user_id: profile ? profile.id : null,
    email: tx.email,
    username: tx.username,
    amount: parseFloat(tx.amount) || 0,
    package_name: tx.packageName || '',
    status: tx.status || 'pending',
    slip_url: tx.slipUrl || '',
    ref_no: tx.refNo || '',
    reason: tx.reason || '',
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('transactions')
    .upsert(payload);

  if (error) throw error;
  return { status: 'success' };
}

// ==========================================
// REPORTS AND SUGGESTIONS
// ==========================================

export async function submitReport(report) {
  // Find user_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', report.email.trim().toLowerCase())
    .maybeSingle();

  const payload = {
    id: report.id,
    user_id: profile ? profile.id : null,
    email: report.email,
    type: report.type,
    game_title: report.gameTitle || '',
    reported_version: report.reportedVersion || '',
    description: report.description || '',
    changelog: report.changelog || '',
    developer_url: report.developerUrl || '',
    report_tags: report.reportTags || '',
    error_status: report.errorStatus || '',
    status: report.status || 'pending',
    timestamp: report.timestamp || new Date().toISOString()
  };

  const { error } = await supabase
    .from('reports')
    .upsert(payload);

  if (error) throw error;
  return { status: 'success' };
}

export async function getReports() {
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('timestamp', { ascending: false });

  if (error) throw error;

  return data.map(r => ({
    id: r.id || '',
    email: r.email || '',
    type: r.type || 'update',
    gameTitle: r.game_title || '',
    reportedVersion: r.reported_version || '',
    description: r.description || '',
    changelog: r.changelog || '',
    developerUrl: r.developer_url || '',
    reportTags: r.report_tags || '',
    errorStatus: r.error_status || '',
    timestamp: r.timestamp || '',
    status: r.status || 'pending'
  }));
}

export async function updateReportStatus(reportId, status) {
  const { error } = await supabase
    .from('reports')
    .update({ status: status })
    .eq('id', reportId);

  if (error) throw error;
  return { status: 'success' };
}

export async function testConnection() {
  try {
    const { error } = await supabase
      .from('config')
      .select('key')
      .limit(1);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Supabase connection test failed:', err);
    return false;
  }
}

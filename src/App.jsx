import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { initialOfficialGames, initialMockUserLibraries, initialReports } from './data/mockGames';
import { saveTransaction as saveTransactionGAS } from './googleSheets';
import {
  getApiUrl,
  setApiUrl,
  isConfigured,
  registerUser,
  loginWithGoogle,
  getSession,
  logoutUser,
  getUserLibrary,
  saveUserLibrary,
  getAllUserLibraries,
  incrementGameViewCount,
  getOfficialGames,
  getOfficialGameDetail,
  saveOfficialGame,
  deleteOfficialGame,
  getSystemConfig,
  saveSystemConfig,
  submitReport,
  getReports,
  updateReportStatus,
  testConnection,
  updateUserRole,
  getUsersList,
  saveTransaction,
  getTransactions,
  deleteUser,
  getTranslatedGames,
  saveTranslatedGame,
  deleteTranslatedGame,
  incrementTranslatedGameViews,
  getVotingCandidates,
  saveVotingCandidate,
  deleteVotingCandidate,
  getTranslationVotes,
  submitTranslationVote,
  clearTranslationVotes,
  getBanners,
  saveBanner,
  deleteBanner
} from './supabase';

// Mock Data for Translated Games Preview
const initialTranslatedGames = [];

// --- HELPER FUNCTIONS OUTSIDE COMPONENT ---
function generateId() {
  return 'id-' + Math.random().toString(36).substring(2, 11);
}

// CRC16 Checksum for EMVCo PromptPay
function crc16(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    let x = ((crc >> 8) ^ data.charCodeAt(i)) & 0xff;
    x ^= x >> 4;
    crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Generate PromptPay EMVCo string for scannable QR
function generatePromptPayQR(target, amount) {
  if (!target) return '';
  const cleanTarget = target.replace(/\D/g, '');
  let targetType;
  let formattedTarget;
  
  if (cleanTarget.length === 13) {
    targetType = '02'; // Tax ID / National ID
    formattedTarget = cleanTarget;
  } else if (cleanTarget.length === 10 || cleanTarget.length === 9) {
    targetType = '01'; // Mobile Phone
    const mobileNo = cleanTarget.startsWith('0') ? cleanTarget.substring(1) : cleanTarget;
    formattedTarget = '0066' + mobileNo;
  } else {
    return '';
  }
  
  const targetLength = formattedTarget.length.toString().padStart(2, '0');
  const guid = '0016A000000677010111';
  const targetField = `${targetType}${targetLength}${formattedTarget}`;
  const merchantAccountInfoVal = `${guid}${targetField}`;
  const merchantAccountInfoLength = merchantAccountInfoVal.length.toString().padStart(2, '0');
  const merchantAccountInfo = `30${merchantAccountInfoLength}${merchantAccountInfoVal}`;
  
  const currency = '5303764'; // THB
  const formattedAmount = Number(amount).toFixed(2);
  const amountLength = formattedAmount.length.toString().padStart(2, '0');
  const amountField = `54${amountLength}${formattedAmount}`;
  const country = '5802TH';
  
  const payloadWithoutCrc = `000201010212${merchantAccountInfo}${country}${currency}${amountField}6304`;
  const crc = crc16(payloadWithoutCrc);
  return payloadWithoutCrc + crc;
}

function getIsoTimestamp() {
  return new Date().toISOString();
}

function isVersionOlder(localVer, officialVer) {
  if (!localVer || !officialVer) return false;
  if (localVer === officialVer) return false;
  const clean = (v) => v.toString().replace(/[^0-9.]/g, '').split('.').map(Number);
  const v1 = clean(localVer);
  const v2 = clean(officialVer);
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const n1 = v1[i] || 0;
    const n2 = v2[i] || 0;
    if (n1 < n2) return true;
    if (n1 > n2) return false;
  }
  return localVer.localeCompare(officialVer, undefined, { numeric: true, sensitivity: 'base' }) < 0;
}

function getInitials(title) {
  if (!title) return 'AVN';
  return title
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function formatThaiDate(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

const STATUS_CATEGORIES = [
  'วางแผนจะเล่น',
  'กำลังเล่น',
  'เล่นถึงล่าสุด',
  'จบแล้ว',
  'เกมโดนทิ้ง'
];

const STATUS_COLORS = {
  'วางแผนจะเล่น': 'text-slate-400 border-slate-500/20 bg-slate-500/10',
  'กำลังเล่น': 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10',
  'เล่นถึงล่าสุด': 'text-amber-400 border-amber-500/20 bg-amber-500/10',
  'จบแล้ว': 'text-blue-400 border-blue-500/20 bg-blue-500/10',
  'เกมโดนทิ้ง': 'text-rose-400 border-rose-500/20 bg-rose-500/10'
};

function normalizeStatus(status) {
  switch (status) {
    case 'Playing':
      return 'กำลังเล่น';
    case 'Completed':
      return 'จบแล้ว';
    case 'Plan to Play':
    case 'Plan to play':
      return 'วางแผนจะเล่น';
    case 'On Hold':
      return 'เล่นถึงล่าสุด';
    case 'Dropped':
      return 'เกมโดนทิ้ง';
    default:
      if (STATUS_CATEGORIES.includes(status)) {
        return status;
      }
      return 'วางแผนจะเล่น';
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

const OFFICIAL_SCREENSHOT_PLACEHOLDERS = [
  'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=800&auto=format&fit=crop'
];

// UI Star Renderer
function renderReviewStars(rating, interactive = false, onSelect = null) {
  const rounded = Math.round(rating);
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => onSelect && onSelect(star)}
          className={`${interactive ? 'cursor-pointer hover:scale-125 transition-transform duration-150' : ''} focus:outline-none`}
        >
          <span className={`text-base ${star <= rounded ? 'text-amber-400' : 'text-slate-700'}`}>
            ★
          </span>
        </button>
      ))}
    </div>
  );
}

function getUserGmail(username) {
  return username;
}

// Markdown Helper for Inline Text (Bold & Links)
const parseInlineStyles = (text) => {
  if (!text) return '';
  const parts = text.split(/(\*\*.*?\*\*|\[.*?\]\(.*?\))/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-extrabold text-slate-100">{part.substring(2, part.length - 2)}</strong>;
    }
    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline font-bold cursor-pointer"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
};

// Line-by-line Markdown Parser
const renderMarkdown = (content) => {
  if (!content) return null;
  const lines = content.split('\n');
  
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    
    // 1. Headings
    if (trimmed.startsWith('# ')) {
      return <h1 key={idx} className="text-lg font-black text-slate-100 mt-5 mb-2.5 border-b border-slate-900 pb-1">{trimmed.substring(2)}</h1>;
    }
    if (trimmed.startsWith('## ')) {
      return <h2 key={idx} className="text-base font-extrabold text-slate-200 mt-4 mb-2">{trimmed.substring(3)}</h2>;
    }
    if (trimmed.startsWith('### ')) {
      return <h3 key={idx} className="text-sm font-bold text-slate-300 mt-3 mb-1.5">{trimmed.substring(4)}</h3>;
    }
    
    // 2. Unordered lists
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return <li key={idx} className="list-disc ml-5 text-sm text-slate-300 leading-relaxed mb-1">{parseInlineStyles(trimmed.substring(2))}</li>;
    }
    
    // 3. Block link as action button: [Button Text](URL)
    const buttonMatch = trimmed.match(/^\[(.*?)\]\((.*?)\)$/);
    if (buttonMatch) {
      const [, btnText, btnUrl] = buttonMatch;
      let btnStyle = "bg-blue-600 hover:bg-blue-500 shadow-blue-500/20"; // default PC/Generic
      if (btnText.includes('PC') || btnText.includes('Windows') || btnText.includes('Mac') || btnText.includes('คอม')) {
        btnStyle = "bg-blue-600 hover:bg-blue-500 shadow-blue-500/20";
      } else if (btnText.includes('Mobile') || btnText.includes('Android') || btnText.includes('APK') || btnText.includes('มือถือ')) {
        btnStyle = "bg-purple-600 hover:bg-purple-500 shadow-purple-500/20";
      } else if (btnText.includes('กลุ่ม') || btnText.includes('พูดคุย') || btnText.includes('Facebook') || btnText.includes('Social') || btnText.includes('Patreon')) {
        btnStyle = "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20";
      }
      
      return (
        <div key={idx} className="my-3">
          <a
            href={btnUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 text-white font-extrabold text-xs py-2.5 px-5 rounded-xl shadow-lg transition-all active:scale-98 cursor-pointer ${btnStyle}`}
          >
            {btnText}
          </a>
        </div>
      );
    }
    
    // 4. Empty line
    if (trimmed === '') {
      return <div key={idx} className="h-2"></div>;
    }
    
    // 5. Normal text
    return <p key={idx} className="text-sm leading-relaxed text-slate-350 mb-1.5">{parseInlineStyles(line)}</p>;
  });
};

// Insert text at selection helper
const insertMarkdownDirect = (textareaId, markdownText) => {
  const textarea = document.getElementById(textareaId);
  if (!textarea) return;
  
  textarea.focus();
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  
  const before = text.substring(0, start);
  const after = text.substring(end, text.length);
  
  const newValue = before + markdownText + after;
  textarea.value = newValue;
  
  // Dispatch input event to notify any listeners (React form handlers)
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  
  // Set selection range to position after inserted text
  const newPos = start + markdownText.length;
  textarea.setSelectionRange(newPos, newPos);
};

const formatThaiExpiryDate = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const monthIndex = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const month = thaiMonths[monthIndex] || parts[1];
    return `${day} ${month} ${year}`;
  }
  return dateStr;
};

export default function App() {
  // PWA (Install app) State and Handlers
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install: ${outcome}`);
    setDeferredPrompt(null);
  };
  // --- CORE STATE ---
  const [currentUser, setCurrentUser] = useState(() => {
    return localStorage.getItem('avn_current_user_v7') || 'Guest';
  });
  const [currentUsername, setCurrentUsername] = useState(() => {
    return localStorage.getItem('avn_current_username_v7') || 'Guest';
  });

  const [googleSheetsUrl, setGoogleSheetsUrlState] = useState(() => getApiUrl());
  const [isDbConnecting, setIsDbConnecting] = useState(false);

  const updateGoogleSheetsUrl = (url) => {
    setApiUrl(url);
    setGoogleSheetsUrlState(url);
    window.location.reload();
  };

  const handleSaveSystemConfig = async () => {
    try {
      setToastMessage('⏳ กำลังบันทึกการตั้งค่าระบบไปยัง Google Sheets...');
      await saveSystemConfig({
        webTitle,
        webMetaDescription,
        webTagline,
        webLogo,
        webLogoType,
        promptPayId,
        slipOkApiKey,
        slipOkBranchId
      });
      setToastMessage('🟢 บันทึกการตั้งค่าระบบสำเร็จ!');
    } catch (err) {
      alert('❌ ไม่สามารถบันทึกการตั้งค่าระบบ: ' + err.message);
    }
  };

  // --- AUTHENTICATION STATE ---
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);



  // --- USER ROLES & SYSTEM STATES ---
  const [userRoles, setUserRoles] = useState(() => {
    const saved = localStorage.getItem('avn_user_roles_v9');
    if (saved) return JSON.parse(saved);
    return {
      'pattarasak.raksanarong@gmail.com': 'admin',
      'pattarasak.raksanrong@gmail.com': 'admin',
      'Guest': 'free'
    };
  });

  const [userPremiumDates, setUserPremiumDates] = useState(() => {
    const saved = localStorage.getItem('avn_user_premium_dates_v9');
    if (saved) return JSON.parse(saved);
    return {
      'pattarasak.raksanarong@gmail.com': { signupDate: '', expiryDate: '' },
      'pattarasak.raksanrong@gmail.com': { signupDate: '', expiryDate: '' }
    };
  });

  const [userNotifications, setUserNotifications] = useState(() => {
    const saved = localStorage.getItem('avn_user_notifications_v9');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    async function checkSession() {
      try {
        const sessionUser = await getSession();
        if (sessionUser && sessionUser.email) {
          setCurrentUser(sessionUser.email);
          setCurrentUsername(sessionUser.username);
          setUserRoles(prev => ({ ...prev, [sessionUser.email]: sessionUser.role }));
          setUserPremiumDates(prev => ({
            ...prev,
            [sessionUser.email]: { signupDate: sessionUser.signupDate, expiryDate: sessionUser.expiryDate }
          }));
          localStorage.setItem('avn_current_user_v7', sessionUser.email);
          localStorage.setItem('avn_current_username_v7', sessionUser.username);
          
          const savedRoles = JSON.parse(localStorage.getItem('avn_user_roles_v9') || '{}');
          savedRoles[sessionUser.email] = sessionUser.role;
          localStorage.setItem('avn_user_roles_v9', JSON.stringify(savedRoles));
        }
      } catch (err) {
        console.error('Session check failed:', err);
      }
    }
    if (isConfigured()) {
      checkSession();
    }
  }, []);
  const [isUpsellOpen, setIsUpsellOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState('monthly');
  const [isSendingSuggestion, setIsSendingSuggestion] = useState(false);

  // --- SLIP UPLOAD STATES ---
  const [selectedSlipFile, setSelectedSlipFile] = useState(null);
  const [selectedSlipFilePreview, setSelectedSlipFilePreview] = useState(null);
  const [uploadedSlipPreview, setUploadedSlipPreview] = useState(null);
  const [isSlipChecking, setIsSlipChecking] = useState(false);
  const [slipCheckLogs, setSlipCheckLogs] = useState([]);
  const [selectedAdminTxSlip, setSelectedAdminTxSlip] = useState(null);
  const [slipImageLoadError, setSlipImageLoadError] = useState(false);

  // --- REVENUE STATE ---
  const [revenueTransactions, setRevenueTransactions] = useState(() => {
    const saved = localStorage.getItem('avn_revenue_transactions_v9');
    if (saved) return JSON.parse(saved);
    return [];
  });

  const [adminTxSearch, setAdminTxSearch] = useState('');
  const [adminTxStatusFilter, setAdminTxStatusFilter] = useState('All');

  // --- WEBSITE SETTINGS STATES ---
  const [webTitle, setWebTitle] = useState(() => {
    return localStorage.getItem('avn_web_title_v8') || 'AVN Star Hub';
  });

  const [webMetaDescription, setWebMetaDescription] = useState(() => {
    return localStorage.getItem('avn_web_meta_desc_v9') || 'พอร์ทัลแนะนำและติดตามประวัติเกมวิชวลโนเวลยอดนิยม';
  });

  const [webLogo, setWebLogo] = useState(() => {
    return localStorage.getItem('avn_web_logo_v8') || 'ASH';
  });

  const [webLogoType, setWebLogoType] = useState(() => {
    return localStorage.getItem('avn_web_logo_type_v8') || 'text';
  });

  const [webTagline, setWebTagline] = useState(() => {
    return localStorage.getItem('avn_web_tagline_v9') || '★ พอร์ทัลแนะนำแนวและบันทึกเกมยอดนิยม';
  });



  // --- TAG MANAGER STATES ---
  const [globalTags, setGlobalTags] = useState(() => {
    const saved = localStorage.getItem('avn_global_tags_v9');
    if (saved) return JSON.parse(saved);
    const tags = new Set(['Comedy', 'Mystery', 'Adventure', 'Romance', 'Drama', 'Sci-Fi', 'Fantasy', 'Horror', 'Slice of Life']);
    initialOfficialGames.forEach(g => {
      if (g.tags) g.tags.forEach(t => tags.add(t));
    });
    return Array.from(tags).sort();
  });
  const [newTagInput, setNewTagInput] = useState('');
  const [newGmailInput, setNewGmailInput] = useState('');
  const [adminUserSearch, setAdminUserSearch] = useState('');

  const [officialGames, setOfficialGames] = useState(() => {
    const saved = localStorage.getItem('avn_official_games_v9');
    return saved ? JSON.parse(saved) : initialOfficialGames;
  });

  const [userLibraries, setUserLibraries] = useState(() => {
    const saved = localStorage.getItem('avn_user_libraries_v7');
    const parsed = saved ? JSON.parse(saved) : initialMockUserLibraries;
    
    // Normalize status strings to Thai and ensure fields are initialized
    const normalized = {};
    Object.keys(parsed).forEach((user) => {
      normalized[user] = parsed[user].map((item) => ({
        ...item,
        status: normalizeStatus(item.status),
        screenshots: item.screenshots || []
      }));
    });
    return normalized;
  });

  const [reports, setReports] = useState(() => {
    const saved = localStorage.getItem('avn_reports_v7');
    return saved ? JSON.parse(saved) : initialReports;
  });

  const [tickerMessage, setTickerMessage] = useState(() => {
    return localStorage.getItem('avn_ticker_message_v7') || 'ยินดีต้อนรับสู่ AVN Star Hub! ศูนย์รวมคำแนะนำและพอร์ทัลบันทึกความก้าวหน้าเฉพาะสุดยอดเกม AVN ยอดนิยมอันดับหนึ่ง';
  });

  const [showTicker, setShowTicker] = useState(() => {
    const saved = localStorage.getItem('avn_show_ticker_v7');
    return saved ? JSON.parse(saved) : true;
  });

  // --- DATABASE & PAYMENT STATES ---
  const isFirebaseEnabled = isConfigured();
  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [promptPayId, setPromptPayId] = useState(() => {
    return localStorage.getItem('avn_promptpay_id') || import.meta.env.VITE_PROMPTPAY_ID || '0812345678';
  });
  // eslint-disable-next-line no-unused-vars
  const [slipOkApiKey, setSlipOkApiKey] = useState(() => {
    return localStorage.getItem('avn_slipok_api_key') || import.meta.env.VITE_SLIPOK_API_KEY || 'SLIPOKK60C5VA';
  });
  // eslint-disable-next-line no-unused-vars
  const [slipOkBranchId, setSlipOkBranchId] = useState(() => {
    return localStorage.getItem('avn_slipok_branch_id') || import.meta.env.VITE_SLIPOK_BRANCH_ID || '68919';
  });



  // --- UI STATE ---
  const [activeTab, setActiveTab] = useState('online'); // 'online', 'local', 'admin'
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  
  // Tag Filter states
  const [selectedCatalogTags, setSelectedCatalogTags] = useState([]);
  const [catalogTagSearch, setCatalogTagSearch] = useState('');
  const [showTagFilterCatalog, setShowTagFilterCatalog] = useState(false);
  const [catalogSort, setCatalogSort] = useState('date-desc');

  // Translated Games states
  const [translatedGames, setTranslatedGames] = useState(() => {
    const saved = localStorage.getItem('avn_translated_games_preview');
    return saved ? JSON.parse(saved) : initialTranslatedGames;
  });
  const [selectedTranslatedGame, setSelectedTranslatedGame] = useState(null);
  const [isTranslatedModalOpen, setIsTranslatedModalOpen] = useState(false);
  const [isAddTranslatedOpen, setIsAddTranslatedOpen] = useState(false);
  const [isEditTranslatedOpen, setIsEditTranslatedOpen] = useState(false);
  const [editingTranslatedGame, setEditingTranslatedGame] = useState(null);

  // --- CAROUSEL BANNERS & VOTING SYSTEM STATES ---
  const [banners, setBanners] = useState([]);
  const [votingCandidates, setVotingCandidates] = useState([]);
  const [translationVotes, setTranslationVotes] = useState([]);
  const [isVotingModalOpen, setIsVotingModalOpen] = useState(false);
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);

  // Admin CRUD states
  const [isAddBannerOpen, setIsAddBannerOpen] = useState(false);
  const [isEditBannerOpen, setIsEditBannerOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState(null);
  
  const [isAddCandidateOpen, setIsAddCandidateOpen] = useState(false);
  const [isEditCandidateOpen, setIsEditCandidateOpen] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState(null);

  // Temp form states for Banners
  const [bannerFormType, setBannerFormType] = useState('normal');
  const [bannerFormTitle, setBannerFormTitle] = useState('');
  const [bannerFormSubtitle, setBannerFormSubtitle] = useState('');
  const [bannerFormCoverUrl, setBannerFormCoverUrl] = useState('');
  const [bannerFormBgGradient, setBannerFormBgGradient] = useState('from-blue-955/70 to-indigo-950/70');
  const [bannerFormLinkUrl, setBannerFormLinkUrl] = useState('');
  const [bannerFormTargetGameId, setBannerFormTargetGameId] = useState('');
  const [bannerFormIsActive, setBannerFormIsActive] = useState(true);
  const [bannerFormSortOrder, setBannerFormSortOrder] = useState(0);

  // Temp form states for Candidates
  const [candidateFormTitle, setCandidateFormTitle] = useState('');
  const [candidateFormDescription, setCandidateFormDescription] = useState('');
  const [candidateFormCoverUrl, setCandidateFormCoverUrl] = useState('');

  // Reset catalog page during render when search, tags, sort, or tab changes to avoid ESLint warning
  const [prevSearchQuery, setPrevSearchQuery] = useState(searchQuery);
  const [prevCatalogTags, setPrevCatalogTags] = useState(selectedCatalogTags);
  const [prevActiveTab, setPrevActiveTab] = useState(activeTab);
  const [prevCatalogSort, setPrevCatalogSort] = useState(catalogSort);

  if (searchQuery !== prevSearchQuery || selectedCatalogTags !== prevCatalogTags || activeTab !== prevActiveTab || catalogSort !== prevCatalogSort) {
    setPrevSearchQuery(searchQuery);
    setPrevCatalogTags(selectedCatalogTags);
    setPrevActiveTab(activeTab);
    setPrevCatalogSort(catalogSort);
    setCatalogPage(1);
  }

  const [selectedLibraryTags, setSelectedLibraryTags] = useState([]);
  const [libraryTagSearch, setLibraryTagSearch] = useState('');
  const [showTagFilterLibrary, setShowTagFilterLibrary] = useState(false);

  const [adminCatalogSearch, setAdminCatalogSearch] = useState('');
  const [selectedAdminGameIds, setSelectedAdminGameIds] = useState([]);

  const [libraryStatusFilter, setLibraryStatusFilter] = useState('All');
  const [adminReportTab, setAdminReportTab] = useState('update'); // 'update', 'error', 'new'
  const [showNotifications, setShowNotifications] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [isRefreshingAdmin, setIsRefreshingAdmin] = useState(false);

  // --- MODALS STATE ---
  const [selectedGameDetail, setSelectedGameDetail] = useState(null);
  const [activeScreenshotPreview, setActiveScreenshotPreview] = useState(null);
  const [activeScreenshotIndex, setActiveScreenshotIndex] = useState(0);
  const [showAllScreenshots, setShowAllScreenshots] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState('overview');
  const [isOverviewExpanded, setIsOverviewExpanded] = useState(false);

  useEffect(() => {
    setActiveScreenshotIndex(0);
    setShowAllScreenshots(false);
    setShowAllTags(false);
    setActiveDetailTab('overview');
    setIsOverviewExpanded(false);
  }, [selectedGameDetail]);

  const handleOpenGameDetail = async (game) => {
    if (!game) return;
    setSelectedGameDetail(game);
    // Increment viewCount for official games
    if (game.id && game.isCustom === false) {
      setOfficialGames(prev => prev.map(g => g.id === game.id ? { ...g, viewCount: (g.viewCount || 0) + 1 } : g));
      if (isConfigured()) {
        incrementGameViewCount(game.id).catch(err => {
          console.error("Failed to increment view count on Sheets:", err);
        });
      }
      try {
        if (isFirebaseEnabled) {
          const detail = await getOfficialGameDetail(game.id);
          setSelectedGameDetail(prev => {
            if (prev && prev.id === game.id) {
              return {
                ...prev,
                ...detail
              };
            }
            return prev;
          });
        }
      } catch (err) {
        console.error("Failed to fetch official game detail:", err);
      }
    }
  };

  const [isSuggestingNew, setIsSuggestingNew] = useState(false);
  const [isReportingGame, setIsReportingGame] = useState(null);
  const [editingLocalItem, setEditingLocalItem] = useState(null);
  const [customAlert, setCustomAlert] = useState(null);
  const [customConfirm, setCustomConfirm] = useState(null);

  const alert = (msg) => {
    setCustomAlert({ message: msg, title: '🔔 แจ้งเตือนระบบ' });
  };




  // Admin Modals
  const [adminAddGameOpen, setAdminAddGameOpen] = useState(false);
  const [adminEditGameOpen, setAdminEditGameOpen] = useState(false);
  const [activeApprovingReport, setActiveApprovingReport] = useState(null);

  // --- FORM STATES ---
  // Local detailed edit modal fields
  const [localStatus, setLocalStatus] = useState('วางแผนจะเล่น');
  const [localPlayTime, setLocalPlayTime] = useState(0);
  const [localRating, setLocalRating] = useState(0);
  const [localNotes, setLocalNotes] = useState('');
  const [localTitle, setLocalTitle] = useState('');
  const [localDeveloper, setLocalDeveloper] = useState('');
  const [localVersion, setLocalVersion] = useState('');
  const [localCoverUrl, setLocalCoverUrl] = useState('');
  const [localOverview, setLocalOverview] = useState('');
  const [localTags, setLocalTags] = useState('');
  const [localPatreonUrl, setLocalPatreonUrl] = useState('');
  const [localBuyUrl, setLocalBuyUrl] = useState('');
  const [localSocialUrl, setLocalSocialUrl] = useState('');
  const [localScreenshots, setLocalScreenshots] = useState([]);



  // Report submission fields
  const [reportType, setReportType] = useState('update');
  const [reportReportedVersion, setReportReportedVersion] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [reportTags, setReportTags] = useState('');
  const [reportUrls, setReportUrls] = useState('');
  const [reportErrorStatus, setReportErrorStatus] = useState('ข้อมูลล้าสมัย');

  // Community suggestions fields
  const [suggestTitle, setSuggestTitle] = useState('');
  const [suggestDeveloper, setSuggestDeveloper] = useState('');
  const [suggestVersion, setSuggestVersion] = useState('');
  const [suggestCoverUrl, setSuggestCoverUrl] = useState('');
  const [suggestOverview, setSuggestOverview] = useState('');
  const [suggestTags, setSuggestTags] = useState('');
  const [suggestScreenshots, setSuggestScreenshots] = useState([]);
  const [suggestPatreonUrl, setSuggestPatreonUrl] = useState('');
  const [suggestBuyUrl, setSuggestBuyUrl] = useState('');
  const [suggestSocialUrl, setSuggestSocialUrl] = useState('');

  // Admin Catalog Modal form fields
  const [adminFormMode, setAdminFormMode] = useState('add'); // 'add' or 'edit'
  const [adminFormGameId, setAdminFormGameId] = useState(null);
  const [adminTitle, setAdminTitle] = useState('');
  const [adminDeveloper, setAdminDeveloper] = useState('');
  const [adminVersion, setAdminVersion] = useState('');
  const [adminOverview, setAdminOverview] = useState('');
  const [adminCoverUrl, setAdminCoverUrl] = useState('');
  const [adminPatreonUrl, setAdminPatreonUrl] = useState('');
  const [adminBuyUrl, setAdminBuyUrl] = useState('');
  const [adminSocialUrl, setAdminSocialUrl] = useState('');
  const [adminTags, setAdminTags] = useState('');
  const [adminRating, setAdminRating] = useState(5.0);
  const [adminScreenshots, setAdminScreenshots] = useState([]);

  // Admin announcement ticker temp fields
  const [tempTickerMessage, setTempTickerMessage] = useState(tickerMessage);
  const [tempShowTicker, setTempShowTicker] = useState(showTicker);

  // Game Engagement states
  const [allUserLibraries, setAllUserLibraries] = useState([]);
  const [isRefreshingEngage, setIsRefreshingEngage] = useState(false);
  const [engageSearch, setEngageSearch] = useState('');
  const [engageSort, setEngageSort] = useState('engage-desc');

  // Admin Catalog pagination states
  const [adminCatalogPage, setAdminCatalogPage] = useState(1);

  // --- USER ROLE DERIVATIONS ---
  const subscriptionRole = 
    (currentUser === 'pattarasak.raksanarong@gmail.com' || currentUser === 'pattarasak.raksanrong@gmail.com') 
      ? 'admin' 
      : (userRoles[currentUser] === 'admin' || userRoles[currentUser] === 'premium') 
        ? userRoles[currentUser] 
        : 'free';
  const isAdmin = subscriptionRole === 'admin';
  const isGuest = currentUser === 'Guest';

  // eslint-disable-next-line no-unused-vars
  const promptPayPayload = useMemo(() => {
    return generatePromptPayQR(promptPayId, selectedPackage === 'monthly' ? 49 : 499);
  }, [promptPayId, selectedPackage]);

  // qrCodeUrl calculated inline in image rendering

  // --- FIRESTORE HELPER & LIFE CYCLES ---


  // Clear old mock data caches on first load of this production version
  useEffect(() => {
    const isMockCleared = localStorage.getItem('avn_mock_cleared_v11');
    if (!isMockCleared) {
      localStorage.removeItem('avn_user_roles_v9');
      localStorage.removeItem('avn_user_premium_dates_v9');
      localStorage.removeItem('avn_revenue_transactions_v9');
      localStorage.removeItem('avn_reports_v7');
      localStorage.removeItem('avn_user_libraries_v7');
      localStorage.removeItem('avn_google_user_profile_v9');
      localStorage.removeItem('avn_current_user_v7');
      localStorage.setItem('avn_mock_cleared_v11', 'true');
      window.location.reload();
    }
  }, []);



  // Helper for stable random hashing
  const sessionRandomSeed = useRef(Math.floor(Math.random() * 1000)).current;
  const hashCode = (str) => {
    let hash = 0;
    if (!str) return hash;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
  };

  // Selected promo games (either target_game_id or a stable random fallback for each banner ID)
  const bannerPromoGames = useMemo(() => {
    const promoMap = {};
    if (officialGames.length === 0) return promoMap;
    
    banners.forEach(b => {
      if (b.type === 'game_promo') {
        if (b.target_game_id) {
          const game = officialGames.find(g => g.id === b.target_game_id);
          if (game) {
            promoMap[b.id] = game;
          } else {
            const idx = Math.abs(hashCode(b.id) + sessionRandomSeed) % officialGames.length;
            promoMap[b.id] = officialGames[idx];
          }
        } else {
          const idx = Math.abs(hashCode(b.id) + sessionRandomSeed) % officialGames.length;
          promoMap[b.id] = officialGames[idx];
        }
      }
    });
    return promoMap;
  }, [banners, officialGames, sessionRandomSeed]);

  // --- DERIVED VOTING LEADERBOARD ---
  const votingLeaderboard = useMemo(() => {
    const stats = {};
    votingCandidates.forEach(c => {
      stats[c.id] = {
        id: c.id,
        title: c.title,
        description: c.description,
        coverUrl: c.cover_url || '',
        premiumCount: 0,
        normalCount: 0,
        total: 0
      };
    });

    translationVotes.forEach(v => {
      if (stats[v.candidate_id]) {
        if (v.is_premium) {
          stats[v.candidate_id].premiumCount += 1;
        } else {
          stats[v.candidate_id].normalCount += 1;
        }
        stats[v.candidate_id].total += 1;
      }
    });

    return Object.values(stats).sort((a, b) => b.total - a.total);
  }, [votingCandidates, translationVotes]);

  // --- AUTO-ROTATE CAROUSEL BANNERS ---
  useEffect(() => {
    const activeBanners = banners.filter(b => b.is_active);
    if (activeBanners.length <= 1) return;
    
    const interval = setInterval(() => {
      setActiveBannerIndex(prev => (prev === activeBanners.length - 1 ? 0 : prev + 1));
    }, 6000);
    
    return () => clearInterval(interval);
  }, [banners]);

  // Mount Effect: Load Supabase Data
  useEffect(() => {
    if (!isFirebaseEnabled) {
      Promise.resolve().then(() => setIsDbLoaded(true));
      return;
    }

    const loadAllSupabaseData = async () => {
      try {
        // 1. Fetch official games
        const gamesList = await getOfficialGames();
        if (gamesList.length === 0) {
          for (const game of initialOfficialGames) {
            await saveOfficialGame(game);
          }
          setOfficialGames(initialOfficialGames);
        } else {
          setOfficialGames(gamesList);
        }

        // 2. Fetch system configurations
        const config = await getSystemConfig();
        if (config.webTitle) setWebTitle(config.webTitle);
        if (config.webMetaDescription) setWebMetaDescription(config.webMetaDescription);
        if (config.webTagline) setWebTagline(config.webTagline);
        if (config.webLogo) setWebLogo(config.webLogo);
        if (config.webLogoType) setWebLogoType(config.webLogoType);
        if (config.tickerMessage) setTickerMessage(config.tickerMessage);
        if (config.showTicker !== undefined) setShowTicker(config.showTicker === 'true' || config.showTicker === true);
        if (config.promptPayId) {
          setPromptPayId(config.promptPayId);
          localStorage.setItem('avn_promptpay_id', config.promptPayId);
        }
        if (config.slipOkApiKey) {
          setSlipOkApiKey(config.slipOkApiKey);
          localStorage.setItem('avn_slipok_api_key', config.slipOkApiKey);
        }
        if (config.slipOkBranchId) {
          setSlipOkBranchId(config.slipOkBranchId);
          localStorage.setItem('avn_slipok_branch_id', config.slipOkBranchId);
        }


        // 3. Fetch user roles & premium dates
        // 3. Set default user roles & premium dates (profiles loaded on-demand for admin)
        const rolesObj = {
          'pattarasak.raksanarong@gmail.com': 'admin',
          'pattarasak.raksanrong@gmail.com': 'admin',
          'Guest': 'free'
        };
        const premiumObj = {
          'pattarasak.raksanarong@gmail.com': { signupDate: '', expiryDate: '' },
          'pattarasak.raksanrong@gmail.com': { signupDate: '', expiryDate: '' }
        };
        setUserRoles(prev => ({ ...rolesObj, ...prev }));
        setUserPremiumDates(prev => ({ ...premiumObj, ...prev }));

        // 4. Initialize empty lists for admin-only tables on mount
        setRevenueTransactions([]);
        setReports([]);

        // 6. Fetch translated games
        const transList = await getTranslatedGames();
        setTranslatedGames(transList);

        // 7. Fetch Banners
        try {
          const bannerList = await getBanners();
          setBanners(bannerList);
        } catch (err) {
          console.warn('Failed to load banners:', err);
        }

        // 8. Fetch Voting Candidates
        try {
          const candidateList = await getVotingCandidates();
          setVotingCandidates(candidateList);
        } catch (err) {
          console.warn('Failed to load voting candidates:', err);
        }

        // 9. Fetch Translation Votes
        try {
          const votesList = await getTranslationVotes();
          setTranslationVotes(votesList);
        } catch (err) {
          console.warn('Failed to load translation votes:', err);
        }

        setIsDbLoaded(true);
      } catch (err) {
        console.error('Error loading Supabase data:', err);
        setIsDbLoaded(true);
      }
    };

    loadAllSupabaseData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session restore on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('avn_current_user_v7') || 'Guest';
    const savedUsername = localStorage.getItem('avn_current_username_v7') || 'Guest';
    if (savedUser !== 'Guest') {
      Promise.resolve().then(() => {
        setCurrentUser(savedUser);
        setCurrentUsername(savedUsername);
      });
    }
  }, [isDbLoaded]);

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (e) {
      console.error(e);
    }
    setCurrentUser('Guest');
    setCurrentUsername('Guest');
    localStorage.removeItem('avn_current_user_v7');
    localStorage.removeItem('avn_current_username_v7');
    setIsUserDropdownOpen(false);
    setToastMessage('🔴 ออกจากระบบแล้ว');
  };



  // Fetch all user libraries for engagement panel when entering admin panel as admin
  useEffect(() => {
    if (isFirebaseEnabled && isDbLoaded && activeTab === 'admin' && isAdmin) {
      fetchEngagementData(true);
      fetchAdminData(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDbLoaded, activeTab, isAdmin, isFirebaseEnabled]);

  // Sync Current User's Library from Supabase on user change
  useEffect(() => {
    if (!isFirebaseEnabled) {
      console.warn("Supabase is not enabled. Cannot sync library.");
      return;
    }
    if (currentUser === 'Guest') return;

    const syncUserLibrary = async () => {
      try {
        const libData = await getUserLibrary(currentUser);
        if (libData.length > 0) {
          setUserLibraries(prev => ({
            ...prev,
            [currentUser]: libData.map(item => ({
              ...item,
              status: normalizeStatus(item.status),
              screenshots: item.screenshots || []
            }))
          }));
        } else {
          const currentLocalLib = userLibraries[currentUser] || [];
          if (currentLocalLib.length > 0) {
            await saveUserLibrary(currentUser, currentLocalLib);
            console.log('Migrated local library to Supabase for', currentUser);
          }
        }
      } catch (err) {
        console.error('Error syncing user library:', err);
      }
    };

    syncUserLibrary();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, isDbLoaded]);

  // --- SYNC STATE TO STORAGE ---
  useEffect(() => {
    localStorage.setItem('avn_current_user_v7', currentUser);
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('avn_current_username_v7', currentUsername);
  }, [currentUsername]);



  useEffect(() => {
    localStorage.setItem('avn_user_roles_v9', JSON.stringify(userRoles));
  }, [userRoles]);

  useEffect(() => {
    localStorage.setItem('avn_user_premium_dates_v9', JSON.stringify(userPremiumDates));
  }, [userPremiumDates]);

  useEffect(() => {
    localStorage.setItem('avn_user_notifications_v9', JSON.stringify(userNotifications));
  }, [userNotifications]);

  useEffect(() => {
    localStorage.setItem('avn_revenue_transactions_v9', JSON.stringify(revenueTransactions));
  }, [revenueTransactions]);

  useEffect(() => {
    localStorage.setItem('avn_web_tagline_v9', webTagline);
  }, [webTagline]);

  useEffect(() => {
    localStorage.setItem('avn_global_tags_v9', JSON.stringify(globalTags));
  }, [globalTags]);

  useEffect(() => {
    localStorage.setItem('avn_official_games_v9', JSON.stringify(officialGames));
  }, [officialGames]);

  const prevLibRef = useRef([]);
  useEffect(() => {
    localStorage.setItem('avn_user_libraries_v7', JSON.stringify(userLibraries));
    
    if (!isFirebaseEnabled || !isDbLoaded || currentUser === 'Guest') {
      return;
    }
    
    const currentLib = userLibraries[currentUser] || [];
    const prevLib = prevLibRef.current;
    
    // Sync library as a whole if there are changes
    if (JSON.stringify(currentLib) !== JSON.stringify(prevLib)) {
      saveUserLibrary(currentUser, currentLib).catch(err => 
        console.error('Error saving library to Supabase:', err)
      );
      prevLibRef.current = currentLib;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLibraries, currentUser, isDbLoaded]);

  useEffect(() => {
    localStorage.setItem('avn_reports_v7', JSON.stringify(reports));
  }, [reports]);

  useEffect(() => {
    localStorage.setItem('avn_ticker_message_v7', tickerMessage);
  }, [tickerMessage]);

  useEffect(() => {
    localStorage.setItem('avn_show_ticker_v7', JSON.stringify(showTicker));
  }, [showTicker]);

  useEffect(() => {
    localStorage.setItem('avn_web_title_v8', webTitle);
  }, [webTitle]);

  useEffect(() => {
    localStorage.setItem('avn_web_meta_desc_v9', webMetaDescription);
  }, [webMetaDescription]);

  useEffect(() => {
    localStorage.setItem('avn_web_logo_v8', webLogo);
  }, [webLogo]);

  useEffect(() => {
    localStorage.setItem('avn_web_logo_type_v8', webLogoType);
  }, [webLogoType]);



  // DOM Updates for Title & Meta Description
  useEffect(() => {
    document.title = webTitle;
  }, [webTitle]);

  useEffect(() => {
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = webMetaDescription;
  }, [webMetaDescription]);

  // Expiry check when currentUser changes or dates are modified
  useEffect(() => {
    if (currentUser === 'Guest' || currentUser === 'Admin') return;
    
    const userRole = userRoles[currentUser];
    if (userRole === 'premium') {
      const sub = userPremiumDates[currentUser];
      if (sub && sub.expiryDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiry = new Date(sub.expiryDate);
        expiry.setHours(0, 0, 0, 0);
        
        if (today > expiry) {
          setTimeout(() => {
            setUserRoles(prev => ({ ...prev, [currentUser]: 'user' }));
            if (isFirebaseEnabled) {
              updateUserRole(currentUser, 'user')
                .catch(err => console.error('Error auto-downgrading expired premium user:', err));
            }
          }, 0);
           // Format date for Thai notice
          const parts = sub.expiryDate.split('-');
          const displayDate = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : sub.expiryDate;
          setTimeout(() => {
            alert(`⚠️ สมาชิก Premium ของคุณหมดอายุแล้วเมื่อวันที่ ${displayDate} ระบบได้ปรับบทบาทเป็น user ธรรมดาเเล้ว`);
          }, 0);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, userPremiumDates, userRoles]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveScreenshotIndex(0);
  }, [selectedGameDetail]);

  useEffect(() => {
    setSlipImageLoadError(false);
  }, [selectedAdminTxSlip]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Dropdowns click outside listeners
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.bell-btn-container')) {
        setShowNotifications(false);
      }
      if (!e.target.closest('.catalog-tag-filter-container')) {
        setShowTagFilterCatalog(false);
      }
      if (!e.target.closest('.library-tag-filter-container')) {
        setShowTagFilterLibrary(false);
      }
      if (!e.target.closest('.user-profile-container')) {
        setIsUserDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  // --- DERIVED MEMOIZED VALUES ---
  const currentLibraryList = useMemo(() => {
    const list = userLibraries[currentUser] || [];
    return list.map((item) => {
      const origGame = officialGames.find((g) => g.id === item.gameId);
      return {
        ...item,
        title: origGame ? origGame.title : (item.title || 'ไม่พบชื่อเกม'),
        developer: origGame ? origGame.developer : (item.developer || 'ไม่พบผู้พัฒนา'),
        version: origGame ? origGame.version : (item.version || 'ไม่ระบุ'),
        coverUrl: origGame ? origGame.coverUrl : (item.coverUrl || ''),
        overview: origGame ? origGame.overview : (item.overview || ''),
        tags: origGame ? origGame.tags : (item.tags || []),
        patreonUrl: origGame ? origGame.patreonUrl : (item.patreonUrl || ''),
        buyUrl: origGame ? origGame.buyUrl : (item.buyUrl || ''),
        socialUrl: origGame ? origGame.socialUrl : (item.socialUrl || ''),
        screenshots: origGame ? origGame.screenshots : (item.screenshots || []),
        isCustom: false
      };
    });
  }, [userLibraries, currentUser, officialGames]);

  const notifications = useMemo(() => {
    if (currentUser === 'Admin') {
      return reports.filter((r) => r.status === 'pending');
    }
    
    // Calculate Premium Expiry Notification
    const premiumExpiryNotification = [];
    if (subscriptionRole === 'premium') {
      const sub = userPremiumDates[currentUser];
      if (sub && sub.expiryDate) {
        const now = new Date();
        const expiry = new Date(sub.expiryDate);
        expiry.setHours(23, 59, 59, 999); // Expiration is usually at end of the day
        const timeDiff = expiry.getTime() - now.getTime();
        const oneDayMs = 24 * 60 * 60 * 1000;
        
        if (timeDiff > 0 && timeDiff <= oneDayMs) {
          const displayDate = formatThaiExpiryDate(sub.expiryDate);
          premiumExpiryNotification.push({
            id: `premium-expiry-${currentUser}`,
            type: 'premium-expiry',
            message: `👑 สิทธิ์ Premium ของคุณจะหมดอายุในวันที่ ${displayDate} (เหลือเวลาอีกไม่ถึง 24 ชั่วโมง) โปรดต่ออายุสมาชิก!`
          });
        }
      }
    }

    // Calculate local library update notifications
    const libraryUpdates = [];
    if (!isGuest) {
      currentLibraryList.forEach(item => {
        if (item.isCustom) return;
        const official = officialGames.find(g => g.id === item.gameId);
        if (official && isVersionOlder(item.version, official.version)) {
          libraryUpdates.push({
            id: `update-${item.gameId}-${official.version}`,
            type: 'library-update',
            gameId: item.gameId,
            gameTitle: official.title,
            localVersion: item.version,
            newVersion: official.version,
            message: `เกม "${official.title}" มีการอัปเดตใหม่เป็น v${official.version} (เวอร์ชันของคุณ: v${item.version})`
          });
        }
      });
    }

    if (subscriptionRole === 'free') {
      return [...premiumExpiryNotification, ...libraryUpdates];
    }
    
    // For premium users, also merge the custom/official announcements from userNotifications
    const newsNotifications = userNotifications
      .filter((n) => n.recipient === currentUser)
      .map(n => ({
        id: n.id,
        type: 'news',
        gameId: n.gameId,
        gameTitle: n.gameTitle,
        newVersion: n.version,
        message: `เกม "${n.gameTitle}" มีการอัปเดตเป็นเวอร์ชัน ${n.version}!`
      }));

    return [...premiumExpiryNotification, ...libraryUpdates, ...newsNotifications];
  }, [reports, currentUser, subscriptionRole, userNotifications, currentLibraryList, officialGames, userPremiumDates]);

  const googleUser = useMemo(() => {
    if (isGuest) return null;
    return {
      name: currentUsername,
      email: currentUser,
      role: currentUser,
      avatar: ''
    };
  }, [currentUser, currentUsername, isGuest]);



  const allUniqueCatalogTags = useMemo(() => {
    const tags = new Set();
    officialGames.forEach((g) => {
      if (g.tags) {
        g.tags.forEach((tag) => tags.add(tag));
      }
    });
    return Array.from(tags).sort();
  }, [officialGames]);



  const allUniqueLibraryTags = useMemo(() => {
    const tags = new Set();
    currentLibraryList.forEach((item) => {
      if (item.tags) {
        item.tags.forEach((tag) => tags.add(tag));
      }
    });
    return Array.from(tags).sort();
  }, [currentLibraryList]);

  const filteredCatalog = useMemo(() => {
    let result = officialGames.filter((g) => {
      const matchSearch =
        g.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.developer.toLowerCase().includes(searchQuery.toLowerCase());
      const matchTag =
        selectedCatalogTags.length === 0 ||
        selectedCatalogTags.every(tag => g.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
      return matchSearch && matchTag;
    });

    // Sorting
    result.sort((a, b) => {
      if (catalogSort === 'views-desc') {
        return (b.viewCount || 0) - (a.viewCount || 0);
      }
      if (catalogSort === 'views-asc') {
        return (a.viewCount || 0) - (b.viewCount || 0);
      }
      if (catalogSort === 'rating-desc') {
        return (b.rating || 0) - (a.rating || 0);
      }
      if (catalogSort === 'rating-asc') {
        return (a.rating || 0) - (b.rating || 0);
      }
      if (catalogSort === 'date-desc') {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      }
      if (catalogSort === 'date-asc') {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      }
      if (catalogSort === 'title-asc') {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });

    return result;
  }, [officialGames, searchQuery, selectedCatalogTags, catalogSort]);

  const ITEMS_PER_PAGE = 20;
  const totalCatalogItems = filteredCatalog.length;
  const totalCatalogPages = Math.ceil(totalCatalogItems / ITEMS_PER_PAGE);
  const catalogStartIndex = (catalogPage - 1) * ITEMS_PER_PAGE;
  const catalogEndIndex = Math.min(catalogStartIndex + ITEMS_PER_PAGE, totalCatalogItems);
  
  const displayStart = totalCatalogItems === 0 ? 0 : catalogStartIndex + 1;
  const displayEnd = catalogEndIndex;

  const paginatedCatalog = useMemo(() => {
    return filteredCatalog.slice(catalogStartIndex, catalogEndIndex);
  }, [filteredCatalog, catalogStartIndex, catalogEndIndex]);

  // Calculate compact stats for Library Dashboard
  const libraryStats = useMemo(() => {
    const list = currentLibraryList;
    const planToPlay = list.filter(item => item.status === 'วางแผนจะเล่น').length;
    const playing = list.filter(item => item.status === 'กำลังเล่น').length;
    const completed = list.filter(item => item.status === 'จบแล้ว').length;
    const totalPlayTime = list.reduce((sum, item) => sum + (parseFloat(item.playTime) || 0), 0);
    return { planToPlay, playing, completed, totalPlayTime };
  }, [currentLibraryList]);

  const filteredLibrary = useMemo(() => {
    return currentLibraryList.filter((item) => {
      const matchSearch =
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.developer.toLowerCase().includes(searchQuery.toLowerCase());
      const matchTag =
        selectedLibraryTags.length === 0 ||
        (item.tags && selectedLibraryTags.every(tag => item.tags.some(t => t.toLowerCase() === tag.toLowerCase())));
      const matchStatus = libraryStatusFilter === 'All' || item.status === libraryStatusFilter;
      return matchSearch && matchTag && matchStatus;
    });
  }, [currentLibraryList, searchQuery, selectedLibraryTags, libraryStatusFilter]);

  const pendingUpdates = useMemo(() => reports.filter((r) => r.status === 'pending' && r.type === 'update'), [reports]);
  const pendingErrors = useMemo(() => reports.filter((r) => r.status === 'pending' && r.type === 'error'), [reports]);
  const pendingNews = useMemo(() => reports.filter((r) => r.status === 'pending' && r.type === 'new'), [reports]);

  const adminFilteredCatalog = useMemo(() => {
    return officialGames.filter((g) =>
      g.title.toLowerCase().includes(adminCatalogSearch.toLowerCase()) ||
      g.developer.toLowerCase().includes(adminCatalogSearch.toLowerCase())
    );
  }, [officialGames, adminCatalogSearch]);

  const adminCatalogPageSize = 10;
  const adminCatalogTotalPages = Math.ceil(adminFilteredCatalog.length / adminCatalogPageSize) || 1;

  useEffect(() => {
    if (adminCatalogPage > adminCatalogTotalPages) {
      setAdminCatalogPage(1);
    }
  }, [adminFilteredCatalog.length, adminCatalogTotalPages, adminCatalogPage]);

  const adminCatalogPaginatedList = useMemo(() => {
    const startIndex = (adminCatalogPage - 1) * adminCatalogPageSize;
    return adminFilteredCatalog.slice(startIndex, startIndex + adminCatalogPageSize);
  }, [adminFilteredCatalog, adminCatalogPage, adminCatalogPageSize]);

  const filteredTransactions = useMemo(() => {
    return revenueTransactions.filter(tx => {
      const matchSearch = 
        tx.id.toLowerCase().includes(adminTxSearch.toLowerCase()) ||
        (tx.transRef && tx.transRef.toLowerCase().includes(adminTxSearch.toLowerCase())) ||
        tx.email.toLowerCase().includes(adminTxSearch.toLowerCase());
      const matchStatus = adminTxStatusFilter === 'All' || tx.status === adminTxStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [revenueTransactions, adminTxSearch, adminTxStatusFilter]);

  // --- ACTIONS HANDLERS ---

  const fetchEngagementData = async (silent = false) => {
    if (!isFirebaseEnabled) {
      return;
    }
    if (!silent) setIsRefreshingEngage(true);
    try {
      const data = await getAllUserLibraries();
      setAllUserLibraries(data);
    } catch (err) {
      console.error('Error fetching all user libraries for engagement stats:', err);
      setToastMessage('ไม่สามารถดึงข้อมูลคลังสมาชิกออนไลน์ได้: ' + err.message);
    } finally {
      if (!silent) setIsRefreshingEngage(false);
    }
  };

  const fetchAdminData = async (silent = false) => {
    if (!silent) setIsRefreshingAdmin(true);
    try {
      const usersList = await getUsersList();
      const rolesObj = {
        'pattarasak.raksanarong@gmail.com': 'admin',
        'pattarasak.raksanrong@gmail.com': 'admin',
        'Guest': 'free'
      };
      const premiumObj = {
        'pattarasak.raksanarong@gmail.com': { signupDate: '', expiryDate: '' },
        'pattarasak.raksanrong@gmail.com': { signupDate: '', expiryDate: '' }
      };
      usersList.forEach(u => {
        rolesObj[u.email] = u.role;
        premiumObj[u.email] = { signupDate: u.signupDate, expiryDate: u.expiryDate };
      });
      setUserRoles(rolesObj);
      setUserPremiumDates(premiumObj);

      const txList = await getTransactions();
      txList.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setRevenueTransactions(txList);

      const reportsList = await getReports();
      setReports(reportsList);

      if (!silent) setToastMessage('โหลดข้อมูลแอดมินล่าสุดสำเร็จ');
    } catch (err) {
      console.error('Error fetching admin data:', err);
      setToastMessage('ไม่สามารถดึงข้อมูลแอดมินได้: ' + err.message);
    } finally {
      if (!silent) setIsRefreshingAdmin(false);
    }
  };

  const computedEngagement = useMemo(() => {
    const statsMap = {};
    officialGames.forEach(game => {
      statsMap[game.id] = {
        id: game.id,
        title: game.title,
        developer: game.developer,
        coverUrl: game.coverUrl,
        viewCount: game.viewCount || 0,
        engageCount: 0,
        ratingSum: 0,
        ratingCount: 0
      };
    });

    const processLibraryItems = (items) => {
      if (!Array.isArray(items)) return;
      items.forEach(item => {
        const gId = item.gameId || item.gameid;
        if (!gId) return;
        if (statsMap[gId]) {
          statsMap[gId].engageCount += 1;
          const rateVal = parseFloat(item.rating);
          if (!isNaN(rateVal) && rateVal > 0) {
            statsMap[gId].ratingSum += rateVal;
            statsMap[gId].ratingCount += 1;
          }
        }
      });
    };

    if (isFirebaseEnabled && allUserLibraries.length > 0) {
      allUserLibraries.forEach(row => {
        let items;
        try {
          items = typeof row.librarydata === 'string' ? JSON.parse(row.librarydata) : row.librarydata;
        } catch {
          items = [];
        }
        processLibraryItems(items);
      });
    } else {
      Object.keys(userLibraries).forEach(user => {
        const items = userLibraries[user] || [];
        processLibraryItems(items);
      });
    }

    return Object.values(statsMap).map(stat => {
      const avgRatingNum = stat.ratingCount > 0 ? (stat.ratingSum / stat.ratingCount) : 0;
      const averageUserRating = stat.ratingCount > 0 ? avgRatingNum.toFixed(1) : 'ไม่มีรีวิว';
      return {
        ...stat,
        avgRatingNum,
        averageUserRating
      };
    });
  }, [officialGames, userLibraries, allUserLibraries, isFirebaseEnabled]);

  const filteredEngagement = useMemo(() => {
    let result = [...computedEngagement];

    if (engageSearch.trim()) {
      const q = engageSearch.toLowerCase().trim();
      result = result.filter(game => 
        game.title.toLowerCase().includes(q) || 
        game.developer.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      if (engageSort === 'engage-desc') {
        return b.engageCount - a.engageCount;
      } else if (engageSort === 'engage-asc') {
        return a.engageCount - b.engageCount;
      } else if (engageSort === 'views-desc') {
        return b.viewCount - a.viewCount;
      } else if (engageSort === 'views-asc') {
        return a.viewCount - b.viewCount;
      } else if (engageSort === 'rating-desc') {
        const aRate = a.ratingCount > 0 ? a.avgRatingNum : -1;
        const bRate = b.ratingCount > 0 ? b.avgRatingNum : -1;
        return bRate - aRate;
      } else if (engageSort === 'rating-asc') {
        const aRate = a.ratingCount > 0 ? a.avgRatingNum : 999;
        const bRate = b.ratingCount > 0 ? b.avgRatingNum : 999;
        return aRate - bRate;
      }
      return 0;
    });

    return result;
  }, [computedEngagement, engageSearch, engageSort]);

  const handleExportEngagementCsv = () => {
    const headers = ['รหัสเกม', 'ชื่อเกม', 'ผู้พัฒนา', 'จำนวนผู้เล่น (Engagement)', 'คะแนนเฉลี่ยจากผู้เล่น', 'จำนวนผู้รีวิว', 'ยอดคนเข้าชม (Views)'];
    const rows = filteredEngagement.map(game => [
      `"${game.id}"`,
      `"${game.title.replace(/"/g, '""')}"`,
      `"${game.developer.replace(/"/g, '""')}"`,
      game.engageCount,
      game.averageUserRating,
      game.ratingCount,
      game.viewCount
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const date = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `avn_game_engagement_report_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setToastMessage('ส่งออกไฟล์ CSV สถิติความสนใจสำเร็จแล้ว!');
  };





  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSearchQuery('');
    setSelectedCatalogTags([]);
    setSelectedLibraryTags([]);
    setCatalogTagSearch('');
    setLibraryTagSearch('');
    setSelectedAdminGameIds([]);
    if (tab === 'admin') {
      setTempTickerMessage(tickerMessage);
      setTempShowTicker(showTicker);
      if (isFirebaseEnabled) {
        fetchEngagementData(true);
      }
    }
  };

  const handleAddToLibrary = (game, customStatus = 'วางแผนจะเล่น') => {
    if (isGuest) return;
    const currentLib = userLibraries[currentUser] || [];
    if (currentLib.some((item) => item.gameId === game.id)) {
      setToastMessage('เกมนี้อยู่ในคลังของคุณแล้ว');
      return;
    }

    if (subscriptionRole === 'free' && currentUser !== 'Admin' && currentLib.length >= 5) {
      setIsUpsellOpen(true);
      setToastMessage('คลังเกมฟรีจำกัดที่ 5 เกม กรุณาสมัครพรีเมียมเพื่อขยายโควตา');
      return;
    }

    if (!isFirebaseEnabled) {
      alert("⚠️ ไม่ได้เชื่อมต่อ Supabase! ข้อมูลจะบันทึกแค่ในเครื่องชั่วคราวเท่านั้น กรุณาตั้งค่า API Key หรือรันในเบราว์เซอร์หลักที่ตั้งค่าไว้");
    }


    const newItem = {
      gameId: game.id,
      status: customStatus,
      playTime: 0,
      rating: 0,
      notes: '',
      lastUpdated: getIsoTimestamp(),
      isCustom: false
    };

    setUserLibraries({
      ...userLibraries,
      [currentUser]: [...currentLib, newItem]
    });
    setToastMessage(`เพิ่ม "${game.title}" เข้าคลังสำเร็จ!`);
  };

  const handleDeleteLibraryItem = (gameId) => {
    const currentLib = userLibraries[currentUser] || [];
    setUserLibraries({
      ...userLibraries,
      [currentUser]: currentLib.filter((item) => item.gameId !== gameId)
    });
    setToastMessage('ลบเกมออกจากคลังส่วนตัวแล้ว');
  };

  const handleDeleteOfficialGame = (gameId) => {
    setCustomConfirm({
      title: 'ลบเกมออกจากระบบหลัก',
      message: 'คุณแน่ใจหรือไม่ที่จะลบเกมนี้ออกจากระบบหลัก? ข้อมูลประวัติการเล่นของผู้ใช้จะยังคงอยู่ แต่อ้างอิงจะหายไป',
      onConfirm: () => {
        setOfficialGames(officialGames.filter((g) => g.id !== gameId));
        setSelectedAdminGameIds((prev) => prev.filter((id) => id !== gameId));
        setToastMessage('ลบเกมออกจากแคตตาล็อกระบบแล้ว');
        if (isFirebaseEnabled) {
          deleteOfficialGame(gameId)
            .catch(err => console.error('Error deleting official game:', err));
        }
      }
    });
  };

  const handleIgnoreReport = (reportId) => {
    setReports(reports.map((r) => (r.id === reportId ? { ...r, status: 'ignored' } : r)));
    setToastMessage('ปฏิเสธ/ละเว้น รายงานแล้ว');
    if (isFirebaseEnabled) {
      const found = reports.find(r => r.id === reportId);
      if (found) {
        updateReportStatus(reportId, 'ignored')
          .catch(err => console.error('Error ignoring report in Firestore:', err));
      }
    }
  };

  const handleSendUpdateNotification = (game) => {
    const recipients = [];
    Object.keys(userLibraries).forEach((user) => {
      const role = userRoles[user] || 'free';
      const hasGame = userLibraries[user].some((item) => item.gameId === game.id);
      if (hasGame && (role === 'premium' || role === 'admin')) {
        recipients.push(user);
      }
    });

    if (recipients.length === 0) {
      setToastMessage('ไม่พบผู้ใช้ระดับ Premium ที่บันทึกเกมนี้อยู่ในคลัง');
      return;
    }

    const newNotifications = recipients.map((user) => ({
      id: 'unotif-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
      recipient: user,
      gameId: game.id,
      gameTitle: game.title,
      version: game.version,
      timestamp: getIsoTimestamp(),
      read: false
    }));

    setUserNotifications((prev) => [...newNotifications, ...prev]);
    setToastMessage(`📢 ส่งแจ้งเตือนอัปเดตเวอร์ชัน v${game.version} ไปยังผู้ใช้ Premium ${recipients.length} คนสำเร็จ!`);
  };

  const handleSendBulkUpdateNotification = () => {
    if (selectedAdminGameIds.length === 0) {
      setToastMessage('กรุณาเลือกอย่างน้อยหนึ่งเกมก่อนส่งแจ้งเตือน');
      return;
    }

    const premiumUsers = Object.keys(userRoles).filter(
      (username) => userRoles[username] === 'premium' && username !== 'Guest'
    );

    if (premiumUsers.length === 0) {
      setToastMessage('ไม่พบสมาชิกประเภท Premium ในระบบที่จะจัดส่งแจ้งเตือน');
      return;
    }

    const newNotifications = [];
    let idx = 0;
    selectedAdminGameIds.forEach((gameId) => {
      const game = officialGames.find((g) => g.id === gameId);
      if (!game) return;

      premiumUsers.forEach((user) => {
        newNotifications.push({
          id: 'unotif-' + Date.now() + '-' + (idx++) + '-' + Math.random().toString(36).substring(2, 5),
          recipient: user,
          gameId: game.id,
          gameTitle: game.title,
          version: game.version,
          timestamp: getIsoTimestamp(),
          read: false,
          message: `เกม ${game.title} ได้อัปเดตเป็นเวอร์ชัน ${game.version} แล้ว! 🚀`
        });
      });
    });

    setUserNotifications((prev) => [...newNotifications, ...prev]);
    setSelectedAdminGameIds([]);
    setToastMessage(`📢 ส่งแจ้งเตือนอัปเดตเกมให้เฉพาะสมาชิก Premium (${premiumUsers.length} คน) สำเร็จแล้ว!`);
  };


  const handleAdminApproveTx = async (tx) => {
    const email = tx.email;
    if (!isFirebaseEnabled) {
      alert("⚠️ ไม่ได้เชื่อมต่อ Supabase! ข้อมูลจะบันทึกแค่ในเครื่องชั่วคราวเท่านั้น กรุณาตั้งค่า API Key หรือรันในเบราว์เซอร์หลักที่ตั้งค่าไว้");
    }
    setUserRoles(prev => ({
      ...prev,
      [email]: 'premium'
    }));

    const today = new Date();
    const expiry = new Date();
    // Expiration date calculation: 499 Baht/Yearly -> 1 year, else -> 1 month
    if (tx.package === 'yearly' || tx.packageName === 'yearly' || tx.packageName === 'รายปี' || tx.amount === 499) {
      expiry.setFullYear(today.getFullYear() + 1);
    } else {
      expiry.setMonth(today.getMonth() + 1);
    }

    const signupStr = today.toISOString().split('T')[0];
    const expiryStr = expiry.toISOString().split('T')[0];

    setUserPremiumDates(prev => ({
      ...prev,
      [email]: { signupDate: signupStr, expiryDate: expiryStr }
    }));

    setToastMessage(`✔️ อนุมัติสิทธิ์ Premium ให้แก่ผู้ใช้ ${tx.email} สำเร็จ!`);

    if (isFirebaseEnabled) {
      try {
        // 1. Call GAS to delete the file in Google Drive
        let updatedSlipUrl = '[อนุมัติแล้ว - ลบสลิปแล้ว]';
        try {
          const gasRes = await saveTransactionGAS({ ...tx, status: 'success' });
          if (gasRes && gasRes.slipUrl) {
            updatedSlipUrl = gasRes.slipUrl;
          }
        } catch (gasErr) {
          console.error('GAS slip deletion failed:', gasErr);
        }

        // 2. Save approved status to Supabase with the updated slip URL string
        await saveTransaction({ ...tx, status: 'success', slipUrl: updatedSlipUrl });
        await updateUserRole(email, 'premium', signupStr, expiryStr);

        setRevenueTransactions(prev => 
          prev.map(t => t.id === tx.id ? { ...t, status: 'success', slipUrl: updatedSlipUrl } : t)
        );
      } catch (err) {
        console.error('Error approving transaction in Supabase:', err);
      }
    } else {
      setRevenueTransactions(prev => 
        prev.map(t => t.id === tx.id ? { ...t, status: 'success', slipUrl: '[อนุมัติแล้ว - ลบสลิปแล้ว]' } : t)
      );
    }
  };

  const handleAdminRejectTx = async (tx) => {
    setToastMessage(`❌ ปฏิเสธรายการชำระเงินของ ${tx.email} แล้ว`);

    if (isFirebaseEnabled) {
      try {
        // 1. Call GAS to delete the file in Google Drive
        let updatedSlipUrl = '[ปฏิเสธแล้ว - ลบสลิปแล้ว]';
        try {
          const gasRes = await saveTransactionGAS({ ...tx, status: 'failed' });
          if (gasRes && gasRes.slipUrl) {
            updatedSlipUrl = gasRes.slipUrl;
          }
        } catch (gasErr) {
          console.error('GAS slip deletion failed:', gasErr);
        }

        // 2. Save failed status to Supabase with the updated slip URL string
        await saveTransaction({ ...tx, status: 'failed', slipUrl: updatedSlipUrl, reason: 'แอดมินปฏิเสธการตรวจสอบ' });

        setRevenueTransactions(prev => 
          prev.map(t => t.id === tx.id ? { ...t, status: 'failed', reason: 'แอดมินปฏิเสธการตรวจสอบ', slipUrl: updatedSlipUrl } : t)
        );
      } catch (err) {
        console.error('Error rejecting transaction in Supabase:', err);
      }
    } else {
      setRevenueTransactions(prev => 
        prev.map(t => t.id === tx.id ? { ...t, status: 'failed', reason: 'แอดมินปฏิเสธการตรวจสอบ', slipUrl: '[ปฏิเสธแล้ว - ลบสลิปแล้ว]' } : t)
      );
    }
  };

  const handleAddGmailUser = async (gmail) => {
    if (!gmail || !gmail.trim()) return;
    const email = gmail.trim().toLowerCase();
    
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      alert('รูปแบบ Gmail ไม่ถูกต้อง กรุณากรอกอีเมลจริง (เช่น example@gmail.com)');
      return;
    }

    if (userRoles[email] !== undefined) {
      alert('บัญชีอีเมลนี้มีอยู่ในระบบแล้ว');
      return;
    }

    if (isFirebaseEnabled) {
      try {
        await registerUser(email.split('@')[0], email, '123456');
      } catch (err) {
        alert(`❌ ไม่สามารถเพิ่มผู้ใช้ลงฐานข้อมูลได้: ${err.message}`);
        return;
      }
    }

    setUserRoles((prev) => ({
      ...prev,
      [email]: 'user'
    }));

    setUserPremiumDates((prev) => ({
      ...prev,
      [email]: { signupDate: '', expiryDate: '' }
    }));

    setUserLibraries((prev) => ({
      ...prev,
      [email]: []
    }));

    setToastMessage(`➕ เพิ่มบัญชี ${email} เข้าสู่ระบบสำเร็จ! (รหัสผ่านเริ่มต้น: 123456)`);
  };

  // Inline library row modifications
  const handleUpdateItemStatus = (gameId, newStatus) => {
    const currentLib = userLibraries[currentUser] || [];
    if (subscriptionRole === 'free' && currentUser !== 'Admin' && currentLib.length > 5) {
      setToastMessage('🔒 โควตาคลังเกมฟรีเกิน 5 เกม กรุณาสมัคร Premium เพื่อแก้ไขข้อมูล');
      return;
    }
    setUserLibraries((prev) => {
      const updated = { ...prev };
      if (updated[currentUser]) {
        updated[currentUser] = updated[currentUser].map((item) =>
          item.gameId === gameId
            ? { ...item, status: newStatus, lastUpdated: getIsoTimestamp() }
            : item
        );
      }
      return updated;
    });
    setToastMessage('อัปเดตสถานะเกมแล้ว');
  };

  const handleUpdateItemNotes = (gameId, newNotes) => {
    const currentLib = userLibraries[currentUser] || [];
    if (subscriptionRole === 'free' && currentUser !== 'Admin' && currentLib.length > 5) {
      setToastMessage('🔒 โควตาคลังเกมฟรีเกิน 5 เกม กรุณาสมัคร Premium เพื่อแก้ไขข้อมูล');
      return;
    }
    setUserLibraries((prev) => {
      const updated = { ...prev };
      if (updated[currentUser]) {
        updated[currentUser] = updated[currentUser].map((item) =>
          item.gameId === gameId
            ? { ...item, notes: newNotes, lastUpdated: getIsoTimestamp() }
            : item
        );
      }
      return updated;
    });
  };

  const handleUpdateItemPlayTime = (gameId, newPlayTime) => {
    const currentLib = userLibraries[currentUser] || [];
    if (subscriptionRole === 'free' && currentUser !== 'Admin' && currentLib.length > 5) {
      setToastMessage('🔒 โควตาคลังเกมฟรีเกิน 5 เกม กรุณาสมัคร Premium เพื่อแก้ไขข้อมูล');
      return;
    }
    const hours = parseFloat(newPlayTime) || 0;
    setUserLibraries((prev) => {
      const updated = { ...prev };
      if (updated[currentUser]) {
        updated[currentUser] = updated[currentUser].map((item) =>
          item.gameId === gameId
            ? { ...item, playTime: hours, lastUpdated: getIsoTimestamp() }
            : item
        );
      }
      return updated;
    });
  };

  const handleUpdateItemRating = (gameId, newRating) => {
    const currentLib = userLibraries[currentUser] || [];
    if (subscriptionRole === 'free' && currentUser !== 'Admin' && currentLib.length > 5) {
      setToastMessage('🔒 โควตาคลังเกมฟรีเกิน 5 เกม กรุณาสมัคร Premium เพื่อแก้ไขข้อมูล');
      return;
    }
    setUserLibraries((prev) => {
      const updated = { ...prev };
      if (updated[currentUser]) {
        updated[currentUser] = updated[currentUser].map((item) =>
          item.gameId === gameId
            ? { ...item, rating: newRating, lastUpdated: getIsoTimestamp() }
            : item
        );
      }
      return updated;
    });
    setToastMessage('อัปเดตคะแนนรีวิวเรียบร้อย');
  };

  // Detailed local edit modal initialization
  const openEditLocalItem = (item) => {
    setEditingLocalItem(item);
    setLocalStatus(item.status || 'วางแผนจะเล่น');
    setLocalPlayTime(item.playTime || 0);
    setLocalRating(item.rating || 0);
    setLocalNotes(item.notes || '');
    setLocalTitle(item.title || '');
    setLocalDeveloper(item.developer || '');
    setLocalVersion(item.version || '');
    setLocalCoverUrl(item.coverUrl || '');
    setLocalOverview(item.overview || '');
    setLocalTags(item.tags ? item.tags.join(', ') : '');
    setLocalPatreonUrl(item.patreonUrl || '');
    setLocalBuyUrl(item.buyUrl || '');
    setLocalSocialUrl(item.socialUrl || '');
    setLocalScreenshots(item.screenshots || []);
  };

  const openSuggestNew = () => {
    setSuggestTitle('');
    setSuggestDeveloper('');
    setSuggestVersion('');
    setSuggestCoverUrl('');
    setSuggestOverview('');
    setSuggestTags('');
    setSuggestScreenshots([]);
    setSuggestPatreonUrl('');
    setSuggestBuyUrl('');
    setSuggestSocialUrl('');
    setIsSuggestingNew(true);
  };

  const openReportGame = (game) => {
    setReportType('update');
    setReportReportedVersion('');
    setReportDescription('');
    setReportTags('');
    setReportUrls('');
    setReportErrorStatus('ข้อมูลล้าสมัย');
    setIsReportingGame(game);
  };



  // Form submission saving handlers
  const handleSaveLocalEdit = (e) => {
    e.preventDefault();
    if (!editingLocalItem) return;

    if (subscriptionRole === 'free' && currentUser !== 'Admin' && currentLibraryList.length > 5) {
      alert('🔒 สมาชิก Premium ของคุณหมดอายุแล้วและคลังมีเกมมากกว่า 5 เกม ไม่สามารถแก้ไข/บันทึกประวัติการเล่นได้จนกว่าจะสมัคร Premium อีกครั้ง');
      setEditingLocalItem(null);
      return;
    }

    const updatedLib = currentLibraryList.map((item) => {
      if (item.gameId === editingLocalItem.gameId) {
        return {
          gameId: item.gameId,
          status: localStatus,
          playTime: parseFloat(localPlayTime) || 0,
          rating: parseFloat(localRating) || 0,
          notes: localNotes,
          isCustom: false,
          lastUpdated: getIsoTimestamp()
        };
      }
      // Sanitize other items to keep library clean
      return {
        gameId: item.gameId,
        status: item.status,
        playTime: parseFloat(item.playTime) || 0,
        rating: parseFloat(item.rating) || 0,
        notes: item.notes || '',
        isCustom: false,
        lastUpdated: item.lastUpdated || getIsoTimestamp()
      };
    });

    setUserLibraries({
      ...userLibraries,
      [currentUser]: updatedLib
    });

    setEditingLocalItem(null);
    setToastMessage('บันทึกรายละเอียดประวัติการเล่นแล้ว!');
  };

  // Base64 Cover File Upload (Custom Game)
  const handleCoverUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const base64 = await readFileAsBase64(file);
        setLocalCoverUrl(base64);
        setToastMessage('อัปโหลดรูปปกสำเร็จ!');
      } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการแปลงไฟล์รูปภาพ');
      }
    }
  };

  // Submit Premium Request without Slip File
  const handleSubmitApprovalRequest = async () => {
    try {
      setIsSlipChecking(true);
      setSlipCheckLogs([
        '🤖 [ระบบ] กำลังสร้างคำขออนุมัติ...',
        '🤖 [ระบบ] กำลังบันทึกคำขอไปยังฐานข้อมูล Supabase...'
      ]);

      const txEmail = getUserGmail(currentUser);
      const transRef = 'ref-' + Date.now() + Math.floor(1000 + Math.random() * 9000);
      const txId = 'tx-' + Date.now();
      const amountVal = selectedPackage === 'monthly' ? 49 : 499;

      const newTxSupabase = {
        id: txId,
        refNo: transRef,
        username: currentUsername,
        email: txEmail,
        packageName: selectedPackage,
        amount: amountVal,
        timestamp: getIsoTimestamp(),
        status: 'pending',
        slipUrl: '[ส่งสลิปทาง Facebook Page]',
        reason: 'ขออนุมัติ Premium (โอนเงินและแจ้งสลิปทาง Facebook)'
      };

      await saveTransaction(newTxSupabase);

      setSlipCheckLogs(prev => [...prev, '🟢 [ระบบ] บันทึกคำขออนุมัติลงระบบสำเร็จ!']);

      const localTx = {
        id: txId,
        refNo: transRef,
        username: currentUsername,
        email: txEmail,
        packageName: selectedPackage,
        amount: amountVal,
        timestamp: getIsoTimestamp(),
        status: 'pending',
        slipUrl: '[ส่งสลิปทาง Facebook Page]',
        reason: 'ขออนุมัติ Premium (โอนเงินและแจ้งสลิปทาง Facebook)'
      };
      setRevenueTransactions(prev => [localTx, ...prev]);

      setTimeout(() => {
        setIsSlipChecking(false);
        setIsUpsellOpen(false);
        setToastMessage('⚠️ ส่งคำขออนุมัติสำเร็จ ส่งเรื่องให้ผู้ดูแลระบบตรวจสอบแล้ว');
      }, 1500);

    } catch (err) {
      console.error(err);
      setSlipCheckLogs(prev => [...prev, '❌ เกิดข้อผิดพลาด: ' + err.message]);
      setTimeout(() => {
        setIsSlipChecking(false);
        alert('ไม่สามารถส่งคำขออนุมัติได้: ' + err.message);
      }, 2500);
    }
  };

  // Real Google Drive Payment Slip Upload
  const handleVerifySlip = (file) => {
    if (!file) return;

    try {
      const previewUrl = URL.createObjectURL(file);
      setUploadedSlipPreview(previewUrl);
      setIsSlipChecking(true);
      setSlipCheckLogs([
        '🤖 [ระบบ] กำลังอ่านไฟล์รูปภาพสลิป...',
        '🤖 [ระบบ] กำลังอัปโหลดสลิปเข้าสู่ Google Drive ของท่าน...'
      ]);

      const amountVal = selectedPackage === 'monthly' ? 49 : 499;

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = reader.result.split(',')[1];
        setSlipCheckLogs(prev => [
          ...prev, 
          '🤖 [ระบบ] กำลังส่งข้อมูลไปยัง Google Apps Script...',
          '🤖 [ระบบ] บันทึกข้อมูลไฟล์ลง Google Drive...'
        ]);

        try {
          const txEmail = getUserGmail(currentUser);
          const transRef = 'ref-' + Date.now() + Math.floor(1000 + Math.random() * 9000);
          const txId = 'tx-' + Date.now();

          // 1. อัปโหลดรูปสลิปไปที่ Google Drive (ผ่าน Google Apps Script saveTransaction API)
          const newTxGAS = {
            id: txId,
            username: currentUsername,
            email: txEmail,
            packageName: selectedPackage,
            amount: amountVal,
            timestamp: getIsoTimestamp(),
            status: 'pending',
            slipBase64: base64Data,
            slipFileName: file.name
          };

          const gasRes = await saveTransactionGAS(newTxGAS);
          const driveSlipUrl = gasRes.slipUrl || previewUrl;

          setSlipCheckLogs(prev => [...prev, '🟢 [ระบบ] อัปโหลดสลิปขึ้น Google Drive สำเร็จ!']);

          // 2. บันทึกธุรกรรมสถานะ pending ลง Supabase พร้อมแนบลิงก์ Google Drive
          const newTxSupabase = {
            id: txId,
            refNo: transRef,
            username: currentUsername,
            email: txEmail,
            packageName: selectedPackage,
            amount: amountVal,
            timestamp: getIsoTimestamp(),
            status: 'pending',
            slipUrl: driveSlipUrl,
            reason: 'ส่งสลิปเพื่อรออนุมัติ'
          };

          await saveTransaction(newTxSupabase);

          setSlipCheckLogs(prev => [...prev, '🟢 [ระบบ] บันทึกรายการลงฐานข้อมูล Supabase สำเร็จ!']);

          const localTx = {
            id: txId,
            refNo: transRef,
            username: currentUsername,
            email: txEmail,
            packageName: selectedPackage,
            amount: amountVal,
            timestamp: getIsoTimestamp(),
            status: 'pending',
            slipUrl: driveSlipUrl,
            reason: 'ส่งสลิปเพื่อรออนุมัติ'
          };
          setRevenueTransactions(prev => [localTx, ...prev]);

          setTimeout(() => {
            setIsSlipChecking(false);
            setUploadedSlipPreview(null);
            setSelectedSlipFile(null);
            setSelectedSlipFilePreview(null);
            setIsUpsellOpen(false);
            setToastMessage('⚠️ อัปโหลดสลิปเสร็จสิ้น ส่งเรื่องให้ผู้ดูแลระบบตรวจสอบและอนุมัติแล้ว');
          }, 1500);

        } catch (uploadErr) {
          console.error(uploadErr);
          setSlipCheckLogs(prev => [...prev, '❌ เกิดข้อผิดพลาด: ' + uploadErr.message]);
          setTimeout(() => {
            setIsSlipChecking(false);
            setUploadedSlipPreview(null);
            alert('ไม่สามารถอัปโหลดรูปสลิปได้: ' + uploadErr.message);
          }, 2500);
        }
      };

      reader.readAsDataURL(file);

    } catch (err) {
      console.error(err);
      alert('เกิดข้อผิดพลาดในการประมวลผลไฟล์รูปภาพ');
      setIsSlipChecking(false);
      setUploadedSlipPreview(null);
    }
  };

  // Base64 Screenshots Upload (Library Edit)
  const handleScreenshotUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      const remainingSlots = 4 - localScreenshots.length;
      const filesToProcess = files.slice(0, remainingSlots);
      
      try {
        const promises = filesToProcess.map(file => readFileAsBase64(file));
        const base64s = await Promise.all(promises);
        setLocalScreenshots(prev => [...prev, ...base64s].slice(0, 4));
        setToastMessage(`อัปโหลดภาพตัวอย่างเพิ่ม ${base64s.length} รูป!`);
      } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ');
      }
    }
  };

  const handleSaveReport = (e) => {
    e.preventDefault();
    if (reportType === 'update' && !reportReportedVersion) {
      alert('กรุณากรอกเวอร์ชันใหม่ที่แนะนำ');
      return;
    }
    if (!reportDescription.trim()) {
      alert('กรุณากรอกคำอธิบายเพิ่มเติมเพื่อส่งรายงาน');
      return;
    }

    const newReport = {
      id: generateId(),
      username: currentUser,
      type: reportType,
      gameId: isReportingGame.gameId || isReportingGame.id,
      gameTitle: isReportingGame.title,
      developer: isReportingGame.developer,
      currentVersion: isReportingGame.version,
      reportedVersion: reportType === 'update' ? reportReportedVersion : (reportReportedVersion || isReportingGame.version),
      description: reportDescription,
      status: 'pending',
      timestamp: getIsoTimestamp(),
      reportTags: reportType === 'error' ? reportTags : undefined,
      reportUrls: reportType === 'error' ? reportUrls : undefined,
      errorStatus: reportType === 'error' ? reportErrorStatus : undefined
    };

    setReports([newReport, ...reports]);
    if (isFirebaseEnabled) {
      submitReport(newReport)
        .catch(err => console.error('Error saving report to Firestore:', err));
    }
    setIsReportingGame(null);
    setToastMessage('ส่งรายงานเรียบร้อยแล้ว แอดมินจะตรวจสอบเร็วๆ นี้');
  };

  const handleSaveSuggestion = async (e) => {
    e.preventDefault();
    if (!suggestTitle.trim() || !suggestDeveloper.trim() || !suggestVersion.trim()) {
      alert('กรุณากรอกข้อมูลที่สำคัญให้ครบถ้วน');
      return;
    }

    setIsSendingSuggestion(true);

    const newReport = {
      id: generateId(),
      username: currentUser,
      type: 'new',
      gameTitle: suggestTitle,
      developer: suggestDeveloper,
      reportedVersion: suggestVersion,
      coverUrl: suggestCoverUrl,
      overview: suggestOverview || 'เสนอแนะโดยสมาชิกคอมมูนิตี้',
      tags: suggestTags.split(',').map((t) => t.trim()).filter(Boolean),
      status: 'pending',
      timestamp: getIsoTimestamp(),
      description: 'ขอเพิ่มเกมใหม่เข้าระบบแคตตาล็อกหลัก',
      patreonUrl: suggestPatreonUrl || '',
      buyUrl: suggestBuyUrl || '',
      socialUrl: suggestSocialUrl || '',
      screenshots: suggestScreenshots || []
    };

    try {
      // AJAX call to FormSubmit to simulate real production email delivery
      await fetch("https://formsubmit.co/ajax/admin.avn@gmail.com", {
        method: "POST",
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          sender: currentUser,
          game: suggestTitle,
          developer: suggestDeveloper,
          version: suggestVersion,
          notes: suggestOverview || 'ขอเพิ่มเกมยอดนิยมเข้าระบบ',
          links: `Patreon: ${suggestPatreonUrl || 'ไม่มี'}, Steam: ${suggestBuyUrl || 'ไม่มี'}`
        })
      });
    } catch (err) {
      console.warn("FormSubmit fetch failed, falling back gracefully", err);
    } finally {
      setReports([newReport, ...reports]);
      if (isFirebaseEnabled) {
        submitReport(newReport)
          .catch(err => console.error('Error saving suggestion to Supabase:', err));
      }
      setIsSendingSuggestion(false);
      setIsSuggestingNew(false);
      setToastMessage('ส่งข้อเสนอเข้า Gmail แอดมินและตู้ Inbox แอดมินเรียบร้อยแล้ว!');
    }
  };

  // --- ADMIN FUNCTIONALITIES ---
  const handleResetAdminForm = () => {
    setAdminFormGameId(null);
    setAdminTitle('');
    setAdminDeveloper('');
    setAdminVersion('');
    setAdminOverview('');
    setAdminCoverUrl('');
    setAdminPatreonUrl('');
    setAdminBuyUrl('');
    setAdminSocialUrl('');
    setAdminTags('');
    setAdminRating(5.0);
    setAdminScreenshots([]);
    setActiveApprovingReport(null);
  };

  const handleSelectGameForEdit = (game) => {
    setAdminFormMode('edit');
    setAdminFormGameId(game.id);
    setAdminTitle(game.title || '');
    setAdminDeveloper(game.developer || '');
    setAdminVersion(game.version || '');
    setAdminOverview(game.overview || '');
    setAdminCoverUrl(game.coverUrl || '');
    setAdminPatreonUrl(game.patreonUrl || '');
    setAdminBuyUrl(game.buyUrl || '');
    setAdminSocialUrl(game.socialUrl || '');
    setAdminTags(game.tags ? game.tags.join(', ') : '');
    setAdminRating(game.rating || 5.0);
    setAdminScreenshots(game.screenshots || []);
    setActiveApprovingReport(null);
  };

  const handleApproveReport = (report) => {
    setActiveApprovingReport(report);
    if (report.type === 'new') {
      setAdminFormMode('add');
      setAdminTitle(report.gameTitle || '');
      setAdminDeveloper(report.developer || '');
      setAdminVersion(report.reportedVersion || '');
      setAdminOverview(report.overview || report.description || '');
      setAdminCoverUrl(report.coverUrl || '');
      setAdminTags(report.tags ? report.tags.join(', ') : (report.reportTags || ''));
      setAdminPatreonUrl(report.patreonUrl || '');
      setAdminBuyUrl(report.buyUrl || '');
      setAdminSocialUrl(report.socialUrl || '');
      setAdminRating(5.0);
      setAdminScreenshots(report.screenshots || []);
      setAdminAddGameOpen(true);
    } else {
      // Find original game for update / error
      const target = officialGames.find(g => g.id === report.gameId);
      if (target) {
        setAdminFormMode('edit');
        setAdminFormGameId(target.id);
        setAdminTitle(target.title || '');
        setAdminDeveloper(target.developer || '');
        setAdminVersion(report.reportedVersion || target.version);
        setAdminOverview(target.overview || '');
        setAdminCoverUrl(target.coverUrl || '');
        setAdminPatreonUrl(report.reportUrls || target.patreonUrl || '');
        setAdminBuyUrl(target.buyUrl || '');
        setAdminSocialUrl(target.socialUrl || '');
        setAdminTags(report.reportTags || (target.tags ? target.tags.join(', ') : ''));
        setAdminRating(target.rating || 5.0);
        setAdminScreenshots(target.screenshots || []);
        setAdminEditGameOpen(true);
      } else {
        alert('ไม่พบเกมหลักอ้างอิงในแคตตาล็อกเพื่ออนุมัติการแก้ไข');
        setActiveApprovingReport(null);
      }
    }
  };

  const handleRejectReport = (reportId) => {
    setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, status: 'rejected' } : r)));
    setToastMessage('ปฏิเสธคำร้องเรียนนี้แล้ว');
  };

  const handleAdminCoverUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const base64 = await readFileAsBase64(file);
        setAdminCoverUrl(base64);
        setToastMessage('อัปโหลดรูปปกของระบบสำเร็จ!');
      } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการอัปโหลดรูปปก');
      }
    }
  };

  const handleAdminScreenshotUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      const remainingSlots = 4 - adminScreenshots.length;
      const filesToProcess = files.slice(0, remainingSlots);
      
      try {
        const promises = filesToProcess.map(file => readFileAsBase64(file));
        const base64s = await Promise.all(promises);
        setAdminScreenshots(prev => [...prev, ...base64s].slice(0, 4));
        setToastMessage(`อัปโหลดรูปภาพตัวอย่างหลักสำเร็จ!`);
      } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ');
      }
    }
  };

  const handleSaveAdminForm = (e) => {
    e.preventDefault();
    if (!adminTitle.trim() || !adminDeveloper.trim() || !adminVersion.trim()) {
      alert('กรุณากรอกฟิลด์สำคัญให้ครบถ้วน (ชื่อเกม, ผู้พัฒนา, เวอร์ชัน)');
      return;
    }

    const tagsArray = adminTags
      ? adminTags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    if (adminFormMode === 'edit') {
      // Edit mode
      const updatedGame = {
        id: adminFormGameId,
        title: adminTitle,
        developer: adminDeveloper,
        version: adminVersion,
        overview: adminOverview,
        coverUrl: adminCoverUrl,
        patreonUrl: adminPatreonUrl,
        buyUrl: adminBuyUrl,
        socialUrl: adminSocialUrl,
        tags: tagsArray,
        rating: parseFloat(adminRating) || 5.0,
        screenshots: adminScreenshots
      };

      setOfficialGames((prev) =>
        prev.map((g) => g.id === adminFormGameId ? updatedGame : g)
      );

      if (isFirebaseEnabled) {
        saveOfficialGame(updatedGame)
          .catch(err => console.error('Error updating official game:', err));
      }

      // Sync changes with user libraries
      setUserLibraries((prev) => {
        const updated = { ...prev };
        Object.keys(updated).forEach((user) => {
          updated[user] = updated[user].map((item) => {
            if (item.gameId === adminFormGameId && !item.isCustom) {
              return {
                ...item,
                title: adminTitle,
                developer: adminDeveloper,
                version: adminVersion,
                coverUrl: adminCoverUrl,
                overview: adminOverview,
                tags: tagsArray,
                patreonUrl: adminPatreonUrl,
                buyUrl: adminBuyUrl,
                socialUrl: adminSocialUrl,
                screenshots: adminScreenshots
              };
            }
            return item;
          });
        });
        return updated;
      });

      setToastMessage(`แก้ไขข้อมูลเกมหลัก "${adminTitle}" เรียบร้อยแล้ว`);
      setAdminEditGameOpen(false);
    } else {
      // Add mode
      const slug = adminTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') || `game-${Date.now()}`;
      
      const newGame = {
        id: slug,
        title: adminTitle,
        developer: adminDeveloper,
        version: adminVersion,
        overview: adminOverview || 'เรื่องย่ออย่างเป็นทางการยังไม่มีข้อมูลในระบบ',
        tags: tagsArray,
        rating: parseFloat(adminRating) || 5.0,
        coverUrl: adminCoverUrl,
        patreonUrl: adminPatreonUrl,
        buyUrl: adminBuyUrl,
        socialUrl: adminSocialUrl,
        screenshots: adminScreenshots
      };

      setOfficialGames((prev) => [newGame, ...prev]);

      if (isFirebaseEnabled) {
        saveOfficialGame(newGame)
          .catch(err => console.error('Error adding new game:', err));
      }

      setToastMessage(`เพิ่มเกม "${adminTitle}" เข้าระบบแคตตาล็อกเรียบร้อย`);
      setAdminAddGameOpen(false);
    }

    // Set approved status on reports if approved from inbox
    if (activeApprovingReport) {
      setReports((prev) =>
        prev.map((r) => (r.id === activeApprovingReport.id ? { ...r, status: 'approved' } : r))
      );
      if (isFirebaseEnabled) {
        updateReportStatus(activeApprovingReport.id, 'approved')
          .catch(err => console.error('Error updating report status:', err));
      }
      setActiveApprovingReport(null);
    }

    handleResetAdminForm();
  };

  return (
    <div className="min-h-screen bg-slate-955 text-slate-200 flex flex-col font-sans selection:bg-blue-650/30 selection:text-blue-300">
      
      {/* ANNOUNCEMENT ticker (Solid layout) */}
      {showTicker && tickerMessage && (
        <div className="w-full bg-[#131b2e] border-b border-slate-900 py-3.5 text-sm flex items-center relative overflow-hidden shrink-0 z-40">
          <span className="font-extrabold shrink-0 bg-blue-600 px-3 py-1 rounded-full ml-4 text-xs text-white shadow shadow-blue-500/20 uppercase tracking-wider">
            ประกาศวิ่ง
          </span>
          <div className="marquee-container flex-1">
            <div className="marquee-content text-blue-200 text-base font-semibold">
              {tickerMessage}
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="glass-panel border-b border-slate-900 py-3.5 px-4 md:px-6 sticky top-0 z-30 shrink-0">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-4">
          
          {/* Logo & Title Settings */}
          <div className="flex items-center gap-3">
            {webLogoType === 'image' && webLogo ? (
              <img src={webLogo} alt="Logo" className="w-10 h-10 rounded-xl object-cover shadow shadow-blue-500/30 border border-white/10" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-extrabold text-white shadow shadow-blue-500/30 text-lg">
                {webLogo || 'ASH'}
              </div>
            )}
            <div className="hidden md:block">
              <h1 className="text-lg font-extrabold tracking-tight text-slate-100 leading-tight">{webTitle}</h1>
              <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">{webTagline}</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => handleTabChange('online')}
              className={`text-sm px-4 py-2.5 rounded-xl font-bold transition-all h-11 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'online'
                  ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              🌐 แคตตาล็อก
            </button>

            <button
              onClick={() => handleTabChange('translated')}
              className={`text-sm px-4 py-2.5 rounded-xl font-bold transition-all h-11 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'translated'
                  ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              🇹🇭 แปลไทย
            </button>

            <button
              onClick={() => handleTabChange('local')}
              className={`text-sm px-4 py-2.5 rounded-xl font-bold transition-all h-11 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'local'
                  ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
            >
              📚 คลังของฉัน
            </button>

            {subscriptionRole === 'free' && !isGuest && (
              <button
                onClick={() => setIsUpsellOpen(true)}
                className="text-sm px-4 py-2.5 rounded-xl font-extrabold transition-all h-11 flex items-center gap-1.5 cursor-pointer text-amber-400 border border-amber-500/20 hover:border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10 active:scale-95 duration-150"
              >
                👑 สมัคร Premium
              </button>
            )}

            {isAdmin && (
              <button
                onClick={() => handleTabChange('admin')}
                className={`text-sm px-4 py-2.5 rounded-xl font-bold transition-all h-11 flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'admin'
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                🛡️ แอดมิน
              </button>
            )}
          </nav>

          {/* Right Controls */}
          <div className="flex items-center gap-3">
            
            {/* PWA Install Button */}
            {deferredPrompt && (
              <button
                onClick={handleInstallPWA}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-[11px] font-black h-10 px-3.5 rounded-xl cursor-pointer shadow-md transition-all shrink-0 flex items-center gap-1.5 animate-pulse"
                title="ติดตั้งแอปบนเครื่องโทรศัพท์หรือคอมพิวเตอร์"
              >
                📥 ติดตั้งแอป
              </button>
            )}
            
            {/* Notification Bell */}
            {(subscriptionRole === 'admin' || subscriptionRole === 'premium') && (
              <div className="relative bell-btn-container">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="w-11 h-11 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/40 flex items-center justify-center relative transition-all cursor-pointer"
                >
                  <span className="text-xl">🔔</span>
                  {notifications.length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] rounded-full bg-red-650 text-white text-[10px] font-black flex items-center justify-center px-1 animate-pulse shadow-lg shadow-red-500/20">
                      {notifications.length}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-3 w-80 solid-dropdown rounded-2xl shadow-2xl z-50 p-4 animate-fade-in-up">
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-800 mb-2.5">
                      <span className="text-xs font-bold text-slate-350 flex items-center gap-1.5">
                        🔔 การแจ้งเตือนอัปเดต ({notifications.length})
                      </span>
                      {notifications.length > 0 && (
                        <button
                          onClick={() => {
                            if (currentUser === 'Admin') {
                              setReports(reports.map(r => ({ ...r, status: 'ignored' })));
                            } else {
                              setUserNotifications(userNotifications.filter(n => n.recipient !== currentUser));
                            }
                            setToastMessage('ล้างการแจ้งเตือนทั้งหมดแล้ว');
                          }}
                          className="text-[10px] font-bold text-blue-400 hover:text-blue-300 cursor-pointer"
                        >
                          ล้างทั้งหมด
                        </button>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                      {notifications.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 text-xs font-medium">
                          ไม่มีการแจ้งเตือนใหม่
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {notifications.map((notif) => (
                            <div
                              key={notif.id}
                              onClick={() => {
                                if (currentUser === 'Admin') {
                                  handleTabChange('admin');
                                  setAdminReportTab(notif.type);
                                } else {
                                  if (notif.type === 'library-update') {
                                    // Find local library item and open Edit Modal
                                    const libItem = currentLibraryList.find(i => i.gameId === notif.gameId);
                                    if (libItem) {
                                      setEditingLocalItem(libItem);
                                    }
                                  } else if (notif.type === 'premium-expiry') {
                                    setIsUpsellOpen(true);
                                  } else {
                                    const target = officialGames.find((g) => g.id === notif.gameId);
                                    if (target) {
                                      handleOpenGameDetail(target);
                                    }
                                  }
                                }
                                setShowNotifications(false);
                              }}
                              className="p-3 bg-slate-950/70 border border-slate-900 text-xs text-slate-350 hover:bg-slate-900/30 cursor-pointer transition-colors rounded-xl"
                            >
                              <div className="font-medium text-slate-200">
                                {notif.message || (
                                  <div>
                                    {currentUser === 'Admin' ? (
                                      notif.type === 'new' ? (
                                        <span>เสนอแนะเกมใหม่: <span className="font-extrabold text-blue-400">{notif.gameTitle}</span></span>
                                      ) : notif.type === 'error' ? (
                                        <span>รายงานข้อผิดพลาด: <span className="font-extrabold text-red-400">{notif.gameTitle}</span></span>
                                      ) : (
                                        <span>แจ้งเตือนอัปเดต: <span className="font-extrabold text-amber-400">{notif.gameTitle}</span></span>
                                      )
                                    ) : (
                                      <span>เกม <span className="font-extrabold text-blue-400">{notif.gameTitle}</span> อัปเดต v{notif.newVersion || notif.version}!</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="mt-1 flex justify-between items-center text-[10px]">
                                {currentUser === 'Admin' ? (
                                  notif.type === 'update' && (
                                    <span className="text-slate-400">v{notif.currentVersion} ➔ <span className="text-emerald-455 font-bold">v{notif.reportedVersion}</span></span>
                                  )
                                ) : (
                                  !notif.message && (
                                    <span className="text-slate-400">เวอร์ชันล่าสุด: <span className="text-emerald-455 font-bold">v{notif.version}</span></span>
                                  )
                                )}
                                <span className="text-slate-500 block text-right w-full">{notif.timestamp ? formatThaiDate(notif.timestamp) : 'เพิ่งเมื่อครู่'}</span>
                              </div>
                            </div>
                          ))}

                          {subscriptionRole === 'free' && (
                            <div className="text-center py-4 px-2 flex flex-col items-center gap-2 bg-slate-900/40 border border-slate-900 rounded-xl mt-1.5">
                              <p className="text-[10px] text-slate-400 font-bold leading-normal">
                                👑 สมัคร Premium เพื่อรับการแจ้งเตือนอัปเดตเกมทั้งหมดบนแพลตฟอร์มทันที!
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsUpsellOpen(true);
                                  setShowNotifications(false);
                                }}
                                className="bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white text-[9px] font-black py-1.5 px-3 rounded-lg cursor-pointer shadow-md transition-all"
                              >
                                สมัครสมาชิก Premium
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            
                        {/* Google Sign-in or User Dropdown Profile */}
            <div className="flex items-center">
              {isGuest ? (
                <button
                  onClick={() => {

                    setIsAuthModalOpen(true);
                  }}
                  className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold h-10 px-4 rounded-xl transition-all shadow-md focus:outline-none border border-white/10 cursor-pointer animate-fade-in"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h3a3 3 0 013 3v1" />
                  </svg>
                  <span>เข้าสู่ระบบ / สมัครสมาชิก</span>
                </button>
              ) : (
                <div className="relative user-profile-container">
                  <button
                    onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                    className="flex items-center gap-2.5 p-1.5 pr-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-full transition-all focus:outline-none cursor-pointer"
                  >
                    {googleUser?.avatar ? (
                      <img src={googleUser.avatar} alt={googleUser.name} className="w-8 h-8 rounded-full object-cover border border-white/5" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-xs font-black text-white uppercase border border-white/5">
                        {googleUser?.name ? googleUser.name.charAt(0) : 'G'}
                      </div>
                    )}
                    <span className="hidden sm:inline text-xs font-bold text-slate-200">
                      {googleUser?.name}
                    </span>
                    <span className="text-slate-500 text-[10px]">▼</span>
                  </button>

                  {isUserDropdownOpen && (
                    <div className="absolute right-0 mt-2.5 w-64 solid-dropdown rounded-2xl shadow-2xl z-50 p-4 animate-fade-in-up">
                      <div className="flex flex-col items-center text-center pb-3.5 border-b border-slate-900 mb-3">
                        {googleUser?.avatar ? (
                          <img src={googleUser.avatar} alt={googleUser.name} className="w-14 h-14 rounded-full object-cover mb-2 border-2 border-blue-500/20 shadow-lg" />
                        ) : (
                          <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-lg font-black text-white uppercase mb-2">
                            {googleUser?.name ? googleUser.name.charAt(0) : 'G'}
                          </div>
                        )}
                        <div className="font-extrabold text-sm text-slate-100">{googleUser?.name}</div>
                        <div className="text-xs text-slate-400 mt-0.5 truncate w-full">{googleUser?.email}</div>
                        <span className={`mt-2 px-2.5 py-0.5 text-[10px] font-bold rounded-full border ${
                          subscriptionRole === 'admin' 
                            ? 'text-rose-400 border-rose-500/20 bg-rose-500/10' 
                            : subscriptionRole === 'premium'
                            ? 'text-amber-400 border-amber-500/20 bg-amber-500/10'
                            : 'text-blue-400 border-blue-500/20 bg-blue-500/10'
                        }`}>
                          {subscriptionRole === 'admin' ? '🛡️ ผู้ดูแลระบบ (Admin)' : subscriptionRole === 'premium' ? '👑 สมาชิกพรีเมียม (Premium)' : '👥 สมาชิกทั่วไป (Free)'}
                        </span>
                        {subscriptionRole === 'premium' && userPremiumDates[currentUser]?.expiryDate && (
                          <span className="text-[10px] text-amber-500 mt-1.5 font-medium flex items-center gap-1">
                            📅 หมดอายุ: {formatThaiExpiryDate(userPremiumDates[currentUser].expiryDate)}
                          </span>
                        )}
                      </div>
                      
                      {/* Personal Library Backup section */}
                      <div className="flex flex-col gap-2 py-3 border-b border-slate-900 mb-3 text-left">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">💾 สำรองคลังส่วนตัว</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              try {
                                const libraryData = {
                                  username: currentUser,
                                  email: getUserGmail(currentUser),
                                  library: userLibraries[currentUser] || [],
                                  backupType: 'avn_personal_library_v7'
                                };
                                const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
                                  JSON.stringify(libraryData, null, 2)
                                )}`;
                                const downloadAnchor = document.createElement('a');
                                downloadAnchor.setAttribute('href', jsonString);
                                downloadAnchor.setAttribute('download', `avn_library_backup_${currentUser}.json`);
                                document.body.appendChild(downloadAnchor);
                                downloadAnchor.click();
                                downloadAnchor.remove();
                                setToastMessage('ส่งออกคลังประวัติสำเร็จ!');
                              } catch {
                                alert('เกิดข้อผิดพลาดในการส่งออกคลังข้อมูล');
                              }
                            }}
                            className="flex-1 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-[10px] font-bold py-1.5 rounded-lg cursor-pointer text-center"
                            title="ดาวน์โหลดประวัติการเล่นเก็บไว้"
                          >
                            📤 ส่งออกคลัง
                          </button>
                          
                          <div className="flex-1 relative">
                            <input
                              type="file"
                              accept=".json"
                              id="library-backup-import"
                              onChange={(e) => {
                                const file = e.target.files[0];
                                if (!file) return;
                                
                                const reader = new FileReader();
                                reader.onload = (event) => {
                                  try {
                                    const parsed = JSON.parse(event.target.result);
                                    if (parsed.backupType !== 'avn_personal_library_v7' || !Array.isArray(parsed.library)) {
                                      alert('ไฟล์ดังกล่าวไม่ใช่ประวัติคลังเกมนอนุมัติของระบบ AVN Star Hub');
                                      return;
                                    }

                                    if (subscriptionRole === 'free' && currentUser !== 'Admin' && parsed.library.length > 5) {
                                      setIsUpsellOpen(true);
                                      setToastMessage('❌ โควตาคลังฟรีจำกัด 5 เกม ไม่สามารถนำเข้าข้อมูลที่มีเกมมากกว่า 5 เกมได้');
                                      setIsUserDropdownOpen(false);
                                      return;
                                    }

                                    setCustomConfirm({
                                      title: 'นำเข้าข้อมูลคลังประวัติส่วนตัว',
                                      message: `คุณต้องการกู้คืนประวัติคลังเกมจำนวน ${parsed.library.length} เกมมาทับข้อมูลปัจจุบันของคุณหรือไม่?`,
                                      onConfirm: () => {
                                        setUserLibraries(prev => ({
                                          ...prev,
                                          [currentUser]: parsed.library.map(item => ({
                                            ...item,
                                            status: normalizeStatus(item.status)
                                          }))
                                        }));
                                        setToastMessage('📥 นำเข้าคลังประวัติส่วนตัวสำเร็จ!');
                                        setIsUserDropdownOpen(false);
                                      }
                                    });
                                  } catch {
                                    alert('เกิดข้อผิดพลาดในการนำเข้าไฟล์ประวัติ');
                                  }
                                };
                                reader.readAsText(file);
                                e.target.value = '';
                              }}
                              className="hidden"
                            />
                            <label
                              htmlFor="library-backup-import"
                              className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-[10px] font-bold py-1.5 rounded-lg cursor-pointer text-center flex items-center justify-center"
                            >
                              📥 นำเข้าคลัง
                            </label>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={handleLogout}
                        className="w-full h-10 flex items-center justify-center gap-2 bg-rose-600/10 hover:bg-rose-600/25 border border-rose-500/20 hover:border-rose-500/40 text-rose-400 text-xs font-bold rounded-xl cursor-pointer transition-all"
                      >
                        🚪 ออกจากระบบ
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-grow p-4 md:p-6 max-w-[1400px] mx-auto w-full">
        
        {/* OFFICIAL CATALOG */}
        {activeTab === 'online' && (
          <div className="flex flex-col gap-6 animate-fade-in-up">
            
            {/* ANNOUNCEMENT BANNER CAROUSEL SYSTEM */}
            {(() => {
              const activeBanners = banners.filter(b => b.is_active);
              if (activeBanners.length === 0) return null;

              const currentBanner = activeBanners[activeBannerIndex >= activeBanners.length ? 0 : activeBannerIndex];

              const promoGame = bannerPromoGames[currentBanner.id];
              const bannerCover = currentBanner.cover_url || (promoGame ? promoGame.coverUrl : '');
              const bannerTitle = currentBanner.title || (promoGame ? promoGame.title : 'แนะนำเกมน่าเล่น');
              const bannerSubtitle = currentBanner.subtitle || (promoGame ? promoGame.overview : '');

              const handleBannerClick = () => {
                if (currentBanner.type === 'normal') {
                  if (currentBanner.link_url) {
                    window.open(currentBanner.link_url, '_blank');
                  }
                } else if (currentBanner.type === 'game_promo') {
                  if (promoGame) {
                    handleOpenGameDetail(promoGame);
                  }
                } else if (currentBanner.type === 'voting') {
                  setIsVotingModalOpen(true);
                }
              };

              return (
                <div className="relative glass-panel rounded-3xl overflow-hidden border border-slate-800/80 shadow-xl group transition-all duration-300 hover:border-slate-700/60">
                  
                  {/* Banner Content */}
                  <div 
                    onClick={handleBannerClick}
                    className={`p-6 min-h-[140px] flex flex-col sm:flex-row items-center justify-between gap-6 cursor-pointer bg-gradient-to-r ${currentBanner.bg_gradient || 'from-blue-955/70 to-indigo-950/70'} relative`}
                  >
                    
                    {/* Left details */}
                    <div className="flex-1 flex flex-col gap-1.5 text-center sm:text-left">
                      <span className="text-[10px] font-black text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20 uppercase tracking-widest self-center sm:self-start flex items-center gap-1 animate-pulse">
                        {currentBanner.type === 'normal' && '📢 ประกาศข่าวสาร'}
                        {currentBanner.type === 'game_promo' && '🔥 เกมแนะนำพิเศษ'}
                        {currentBanner.type === 'voting' && '🗳️ กิจกรรมโหวตด่วน'}
                      </span>
                      <h2 className="text-base sm:text-lg font-black text-slate-100 mt-1 leading-snug">
                        {bannerTitle}
                      </h2>
                      <p className="text-xs text-slate-400 leading-relaxed font-medium line-clamp-2 max-w-xl">
                        {bannerSubtitle}
                      </p>
                    </div>

                    {/* Right details & Image */}
                    <div className="shrink-0 flex items-center gap-4.5">
                      {bannerCover && (
                        <div className="w-16 h-22 sm:w-20 sm:h-28 rounded-2xl overflow-hidden border border-white/15 shadow-xl bg-slate-900/50 shrink-0">
                          <img src={bannerCover} className="w-full h-full object-cover" alt="" />
                        </div>
                      )}
                      
                      <div className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 h-9.5 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md group-hover:scale-105 active:scale-95">
                        {currentBanner.type === 'normal' && (currentBanner.link_url ? '🔗 เปิดลิงก์' : '📖 รายละเอียด')}
                        {currentBanner.type === 'game_promo' && '🎮 ดูข้อมูลเกม'}
                        {currentBanner.type === 'voting' && '🗳️ ร่วมลงคะแนนโหวต'}
                      </div>
                    </div>

                  </div>

                  {/* Carousel Controllers */}
                  {activeBanners.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveBannerIndex(prev => (prev === 0 ? activeBanners.length - 1 : prev - 1));
                        }}
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-950/85 hover:bg-slate-900 border border-slate-800 text-white font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-105 active:scale-95 cursor-pointer z-10"
                      >
                        &lt;
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveBannerIndex(prev => (prev === activeBanners.length - 1 ? 0 : prev + 1));
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-950/85 hover:bg-slate-900 border border-slate-800 text-white font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-105 active:scale-95 cursor-pointer z-10"
                      >
                        &gt;
                      </button>

                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                        {activeBanners.map((_, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveBannerIndex(idx);
                            }}
                            className={`w-1.5 h-1.5 rounded-full transition-all cursor-pointer ${
                              idx === (activeBannerIndex >= activeBanners.length ? 0 : activeBannerIndex) ? 'bg-blue-500 w-3' : 'bg-slate-600 hover:bg-slate-500'
                            }`}
                          />
                        ))}
                      </div>
                    </>
                  )}

                </div>
              );
            })()}

            {/* Search Input Panels */}
            <div className="flex flex-col md:flex-row gap-4 items-stretch justify-between w-full">
              <div className="flex flex-col sm:flex-row gap-4 flex-1">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-4 flex items-center text-slate-500">🔍</span>
                  <input
                    type="text"
                    placeholder="ค้นหาชื่อเกม หรือผู้พัฒนา..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="glass-input w-full h-11 pl-11 pr-4 text-sm rounded-xl focus:outline-none"
                  />
                </div>
                
                {/* Catalog Tag Filter Button & Dropdown */}
                <div className="relative w-full sm:w-64 catalog-tag-filter-container">
                  <button
                    type="button"
                    onClick={() => setShowTagFilterCatalog(!showTagFilterCatalog)}
                    className={`glass-input w-full h-11 px-4 text-sm rounded-xl flex items-center justify-between cursor-pointer transition-colors ${
                      selectedCatalogTags.length > 0 ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'text-slate-400'
                    }`}
                  >
                    <span className="truncate">
                      {selectedCatalogTags.length > 0 ? `ตัวกรองแท็ก (${selectedCatalogTags.length})` : '🔍 เลือกแท็กแนวเกม...'}
                    </span>
                    <span className="text-xs">▼</span>
                  </button>
                  
                  {showTagFilterCatalog && (
                    <div className="absolute left-0 mt-2 w-72 solid-dropdown rounded-2xl shadow-2xl z-50 p-4 animate-fade-in-up">
                      <input
                        type="text"
                        placeholder="พิมพ์ค้นหาแท็ก..."
                        value={catalogTagSearch}
                        onChange={(e) => setCatalogTagSearch(e.target.value)}
                        className="glass-input w-full h-8 px-2.5 text-xs rounded-lg mb-3"
                      />
                      
                      <div className="max-h-48 overflow-y-auto flex flex-col gap-2 pr-1 scrollbar-thin">
                        {allUniqueCatalogTags
                          .filter(tag => tag.toLowerCase().includes(catalogTagSearch.toLowerCase()))
                          .map(tag => {
                            const isChecked = selectedCatalogTags.includes(tag);
                            return (
                              <label key={tag} className="flex items-center gap-2.5 text-xs text-slate-300 hover:text-slate-100 cursor-pointer py-0.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    if (isChecked) {
                                      setSelectedCatalogTags(selectedCatalogTags.filter(t => t !== tag));
                                    } else {
                                      setSelectedCatalogTags([...selectedCatalogTags, tag]);
                                    }
                                  }}
                                  className="w-4 h-4 accent-blue-500 rounded border-slate-700 bg-slate-900 cursor-pointer"
                                />
                                <span className="font-medium">#{tag}</span>
                              </label>
                            );
                          })}
                        {allUniqueCatalogTags.filter(tag => tag.toLowerCase().includes(catalogTagSearch.toLowerCase())).length === 0 && (
                          <div className="text-center text-slate-550 py-3 text-xs italic">ไม่พบชื่อแท็กนี้</div>
                        )}
                      </div>
                      
                      <div className="mt-3.5 pt-2 border-t border-slate-900/60 flex justify-between gap-2">
                        {selectedCatalogTags.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelectedCatalogTags([])}
                            className="text-[10px] font-bold text-red-400 hover:underline cursor-pointer"
                          >
                            ล้างทั้งหมด
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowTagFilterCatalog(false)}
                          className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white text-[10px] font-bold px-3 py-1 rounded-md ml-auto cursor-pointer"
                        >
                          ปิด
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sort Dropdown */}
                <div className="relative w-full sm:w-48">
                  <select
                    value={catalogSort}
                    onChange={(e) => setCatalogSort(e.target.value)}
                    className="glass-input w-full h-11 px-4 pr-8 text-sm rounded-xl focus:outline-none bg-slate-900/60 border border-slate-800 hover:border-slate-700 text-slate-300 font-medium cursor-pointer transition-colors appearance-none"
                    style={{
                      backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E")`,
                      backgroundPosition: 'right 0.5rem center',
                      backgroundSize: '1.5em 1.5em',
                      backgroundRepeat: 'no-repeat'
                    }}
                  >
                    <option value="views-desc" className="bg-slate-950 text-slate-300">🔥 ยอดวิว: มาก ➔ น้อย</option>
                    <option value="views-asc" className="bg-slate-950 text-slate-300">❄️ ยอดวิว: น้อย ➔ มาก</option>
                    <option value="rating-desc" className="bg-slate-950 text-slate-300">⭐ คะแนน: มาก ➔ น้อย</option>
                    <option value="rating-asc" className="bg-slate-950 text-slate-300">⭐ คะแนน: น้อย ➔ มาก</option>
                    <option value="date-desc" className="bg-slate-950 text-slate-300">📅 วันที่อัปเดต: ใหม่ ➔ เก่า</option>
                    <option value="date-asc" className="bg-slate-950 text-slate-300">📅 วันที่อัปเดต: เก่า ➔ ใหม่</option>
                    <option value="title-asc" className="bg-slate-950 text-slate-300">🔤 ชื่อเกม: A ➔ Z</option>
                  </select>
                </div>
              </div>

              <button
                onClick={() => {
                  if (isGuest) {

                    setIsAuthModalOpen(true);
                    setToastMessage('กรุณาลงชื่อเข้าใช้เพื่อเสนอแนะเกมใหม่');
                  } else {
                    openSuggestNew();
                  }
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-5 h-11 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-blue-500/25 active:scale-95 text-sm cursor-pointer w-full md:w-auto justify-center animate-fade-in"
              >
                ➕ เสนอแนะเกมใหม่
              </button>
            </div>



            {/* Catalog Grid */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-extrabold text-slate-500">แสดงเกมที่ {displayStart}-{displayEnd} จาก {totalCatalogItems} รายการ</span>
              </div>

              {totalCatalogItems === 0 ? (
                <div className="text-center py-24 glass-panel rounded-3xl border border-slate-900">
                  <span className="text-5xl block mb-3">🔍</span>
                  <p className="text-slate-450 font-bold text-base">ไม่พบเกมตามเงื่อนไขที่คุณค้นหา</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  {paginatedCatalog.map((game) => {
                    const libraryItem = currentLibraryList.find((item) => item.gameId === game.id);
                    const isInLib = !!libraryItem;

                    return (
                      <div
                        key={game.id}
                        onClick={() => handleOpenGameDetail(game)}
                        className="glass-card-minimal rounded-3xl overflow-hidden flex flex-col cursor-pointer group relative"
                      >
                        {/* Cover Image */}
                        <div className="aspect-[3/4] w-full overflow-hidden relative custom-placeholder">
                          {game.coverUrl ? (
                            <img
                              src={game.coverUrl}
                              alt={game.title}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-black text-slate-600 text-2xl">
                              {getInitials(game.title)}
                            </div>
                          )}
                          <div className="absolute top-3 right-3 bg-slate-955/90 backdrop-blur border border-white/10 px-2 py-0.5 rounded-lg text-xs font-extrabold text-blue-400">
                            v{game.version}
                          </div>
                        </div>

                        {/* Details */}
                        <div className="p-4.5 flex flex-col flex-1 gap-2.5">
                          <div>
                            <h3 className="text-base font-extrabold text-slate-100 truncate group-hover:text-blue-400 transition-colors" title={game.title}>
                              {game.title}
                            </h3>
                            <span className="text-xs text-slate-455 font-semibold block mt-0.5">โดย {game.developer}</span>
                          </div>

                          <div className="flex items-center justify-between mt-auto pt-2.5 border-t border-slate-900">
                            {renderReviewStars(game.rating)}
                            <span className="text-xs font-extrabold text-slate-400">{game.rating.toFixed(1)}</span>
                          </div>

                          {/* Action Button */}
                          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                            {isGuest ? (
                              <button
                                onClick={() => {
              
                                  setIsAuthModalOpen(true);
                                  setToastMessage('กรุณาลงชื่อเข้าใช้เพื่อเพิ่มเกมเข้าคลัง');
                                }}
                                className="w-full h-9 bg-blue-600/10 hover:bg-blue-600 hover:text-white border border-blue-500/25 rounded-xl flex items-center justify-center text-xs text-blue-400 font-bold transition-all cursor-pointer animate-fade-in"
                              >
                                ➕ เพิ่มเกมเข้าคลัง
                              </button>
                            ) : isInLib ? (
                              <div className="w-full h-9 bg-emerald-500/10 border border-emerald-500/25 rounded-xl flex items-center justify-center gap-1.5 text-xs text-emerald-450 font-black animate-fade-in">
                                <span>✔️ ในคลัง: {libraryItem.status}</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleAddToLibrary(game)}
                                className="w-full h-9 bg-blue-600/10 hover:bg-blue-600 hover:text-white border border-blue-500/25 rounded-xl flex items-center justify-center text-xs text-blue-400 font-bold transition-all cursor-pointer animate-fade-in"
                              >
                                ➕ เพิ่มเกมเข้าคลัง
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pagination Controls */}
              {totalCatalogPages > 1 && (
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-8 pt-6 border-t border-slate-900/40 animate-fade-in">
                  <span className="text-xs font-extrabold text-slate-500">
                    แสดงเกมที่ {displayStart}-{displayEnd} จาก {totalCatalogItems} รายการ
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCatalogPage(prev => Math.max(prev - 1, 1))}
                      disabled={catalogPage === 1}
                      className="h-9 w-9 flex items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40 text-slate-400 hover:text-white hover:bg-slate-800/60 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                      title="หน้าก่อนหน้า"
                    >
                      ‹
                    </button>
                    
                    {Array.from({ length: totalCatalogPages }).map((_, idx) => {
                      const pageNum = idx + 1;
                      const isNear = Math.abs(catalogPage - pageNum) <= 1;
                      const isFirstOrLast = pageNum === 1 || pageNum === totalCatalogPages;
                      
                      if (!isNear && !isFirstOrLast) {
                        if (pageNum === 2 || pageNum === totalCatalogPages - 1) {
                          return <span key={pageNum} className="text-slate-600 text-xs px-1">...</span>;
                        }
                        return null;
                      }
                      
                      return (
                        <button
                          key={pageNum}
                          type="button"
                          onClick={() => setCatalogPage(pageNum)}
                          className={`h-9 min-w-9 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                            catalogPage === pageNum
                              ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/25'
                              : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:text-white hover:bg-slate-800/60'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    
                    <button
                      type="button"
                      onClick={() => setCatalogPage(prev => Math.min(prev + 1, totalCatalogPages))}
                      disabled={catalogPage === totalCatalogPages}
                      className="h-9 w-9 flex items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40 text-slate-400 hover:text-white hover:bg-slate-800/60 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                      title="หน้าถัดไป"
                    >
                      ›
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TRANSLATED GAMES PORTAL */}
        {activeTab === 'translated' && (
          <div className="flex flex-col gap-6 animate-fade-in-up">
            <div className="text-center py-6">
              <h2 className="text-2xl font-black text-slate-100 flex items-center justify-center gap-2">
                🇹🇭 เกมแปลไทยโดยผู้พัฒนา
              </h2>
              <p className="text-sm text-slate-400 mt-2 max-w-xl mx-auto">
                คลังดาวน์โหลดเกมแนว Visual Novel ที่ได้รับการแปลเป็นภาษาไทยอย่างสมบูรณ์แบบโดยทีมงานของเรา คุณสามารถเข้าอ่านรีวิว ตรวจสอบวิธีติดตั้ง และดาวน์โหลดไปเล่นได้ฟรี!
              </p>
            </div>

            {translatedGames.length === 0 ? (
              <div className="text-center py-20 glass-panel rounded-3xl border border-slate-900">
                <span className="text-5xl block mb-3">📦</span>
                <p className="text-slate-450 font-bold text-base">กำลังปรับปรุงข้อมูลเกมแปลไทยในขณะนี้</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {translatedGames.map((game) => (
                  <div
                    key={game.id}
                    onClick={() => {
                      const isPremium = subscriptionRole === 'premium' || subscriptionRole === 'admin';
                      if (isPremium) {
                        setSelectedTranslatedGame({
                          ...game,
                          views: (game.views || 0) + 1
                        });
                        setIsTranslatedModalOpen(true);
                        incrementTranslatedGameViews(game.id).catch(err => console.error("Error incrementing views:", err));
                        setTranslatedGames(prev => prev.map(g => g.id === game.id ? { ...g, views: (g.views || 0) + 1 } : g));
                      } else {
                        setIsUpsellOpen(true);
                        setToastMessage('👑 สมาชิก Premium เท่านั้นที่สามารถเปิดอ่านบทความและดาวน์โหลดเกมแปลไทยได้');
                      }
                    }}
                    className="glass-panel group hover:border-blue-500/40 rounded-2xl overflow-hidden cursor-pointer flex flex-col transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/5 hover:-translate-y-1 relative"
                  >
                    {/* Cover image */}
                    <div className="aspect-[4/5] relative overflow-hidden bg-slate-950/45 shrink-0">
                      {game.cover_url ? (
                        <img
                          src={game.cover_url}
                          alt={game.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center font-bold text-slate-300">
                          {game.title.substring(0, 2)}
                        </div>
                      )}
                      <div className="absolute top-3 left-3 bg-blue-600/90 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full shadow-lg shadow-blue-500/20 uppercase tracking-wide">
                        {game.version}
                      </div>
                      <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm text-slate-300 text-[10px] font-bold px-2 py-1 rounded-full shadow-lg flex items-center gap-1">
                        👁️ {game.views || 0}
                      </div>
                    </div>

                    {/* Card Content */}
                    <div className="p-4 flex flex-col flex-grow justify-between gap-3">
                      <div>
                        <h3 className="font-extrabold text-sm text-slate-100 group-hover:text-blue-400 transition-colors line-clamp-1">
                          {game.title}
                        </h3>
                      </div>

                      <button
                        type="button"
                        className="w-full bg-slate-900/60 hover:bg-blue-600 text-slate-200 hover:text-white border border-slate-800 hover:border-blue-500 text-xs font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-2"
                      >
                        📖 อ่านรีวิว & ดาวน์โหลด
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* TRANSLATED GAME DETAIL MODAL */}
            {isTranslatedModalOpen && selectedTranslatedGame && (
              <div className="modal-overlay fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div
                  className="glass-panel w-full max-w-2xl rounded-3xl border border-white/10 shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-scale-up"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header / Cover Hero */}
                  <div className="h-44 sm:h-56 relative bg-slate-950/60 shrink-0">
                    {selectedTranslatedGame.cover_url ? (
                      <img
                        src={selectedTranslatedGame.cover_url}
                        alt={selectedTranslatedGame.title}
                        className="w-full h-full object-cover opacity-40 blur-sm animate-pulse-slow"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-r from-blue-950 to-purple-950"></div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent"></div>
                    
                    <button
                      type="button"
                      onClick={() => setIsTranslatedModalOpen(false)}
                      className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 hover:bg-slate-900 text-slate-400 hover:text-white transition-colors cursor-pointer border border-white/5"
                    >
                      ✕
                    </button>

                    <div className="absolute bottom-4 left-6 right-6 flex items-end gap-4 sm:gap-5">
                      <div className="w-20 sm:w-24 aspect-[4/5] rounded-xl overflow-hidden shadow-2xl border border-white/10 shrink-0 bg-slate-900 hidden sm:block">
                        <img src={selectedTranslatedGame.cover_url} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-grow pb-1">
                        <span className="text-[10px] sm:text-xs font-bold text-blue-400 uppercase tracking-wider block mb-1">
                          {selectedTranslatedGame.version} • 👁️ {selectedTranslatedGame.views || 0} views
                        </span>
                        <h2 className="text-lg sm:text-2xl font-black text-slate-100 leading-tight">
                          {selectedTranslatedGame.title}
                        </h2>
                      </div>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-6 overflow-y-auto flex flex-col gap-4 text-slate-300 scrollbar-thin text-xs sm:text-sm">
                    {renderMarkdown(selectedTranslatedGame.description)}
                  </div>

                  {/* Footer */}
                  <div className="px-6 py-4 bg-slate-950/40 border-t border-slate-900 flex justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsTranslatedModalOpen(false)}
                      className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-350 text-xs font-bold h-10 px-5 rounded-xl transition-colors cursor-pointer"
                    >
                      ปิดหน้านี้
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MY LIBRARY (Compact Layout & Card Grid) */}
        {activeTab === 'local' && (
          isGuest ? (
            <div className="max-w-md mx-auto w-full animate-fade-in-up py-16 px-6 glass-panel rounded-3xl border border-white/5 flex flex-col items-center text-center gap-6 shadow-2xl relative overflow-hidden backdrop-blur-2xl my-8">
              {/* Decorative background aura */}
              <div className="absolute -top-20 -left-20 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
              <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
              
              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-600/20 to-purple-600/20 border border-blue-500/30 flex items-center justify-center text-4xl shadow-inner animate-pulse">
                🔒
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-100 mb-2">เข้าสู่คลังส่วนตัวของคุณ</h2>
                <p className="text-sm text-slate-400 leading-relaxed">
                  กรุณาลงชื่อเข้าใช้เพื่อเปิดใช้งานพื้นที่บันทึกคลังประวัติเกมส่วนตัว การให้คะแนน และการบันทึกโน้ตย่อของคุณ
                </p>
              </div>
              <button
                type="button"
                onClick={() => {

                  setIsAuthModalOpen(true);
                }}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-extrabold h-12 px-6 rounded-2xl transition-all shadow-lg focus:outline-none border border-white/10 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h3a3 3 0 013 3v1" />
                </svg>
                <span>ลงชื่อเข้าใช้งานระบบ</span>
              </button>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto w-full animate-fade-in-up flex flex-col gap-6">
            
            {/* User Library Stats Dashboard */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="glass-panel p-4.5 rounded-2xl flex flex-col items-center justify-center text-center">
                <span className="text-slate-450 text-xs font-semibold mb-1">วางแผนจะเล่น</span>
                <span className="text-2xl font-black text-slate-200">{libraryStats.planToPlay}</span>
              </div>
              <div className="glass-panel p-4.5 rounded-2xl flex flex-col items-center justify-center text-center">
                <span className="text-emerald-400 text-xs font-semibold mb-1">กำลังเล่น</span>
                <span className="text-2xl font-black text-emerald-400">{libraryStats.playing}</span>
              </div>
              <div className="glass-panel p-4.5 rounded-2xl flex flex-col items-center justify-center text-center">
                <span className="text-blue-400 text-xs font-semibold mb-1">จบแล้ว</span>
                <span className="text-2xl font-black text-blue-400">{libraryStats.completed}</span>
              </div>
              <div className="glass-panel p-4.5 rounded-2xl flex flex-col items-center justify-center text-center">
                <span className="text-amber-400 text-xs font-semibold mb-1">เวลาเล่นสะสม</span>
                <span className="text-xl font-black text-amber-400">{libraryStats.totalPlayTime.toFixed(1)} ชม.</span>
              </div>
            </div>

            {/* Filters panel */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row gap-4 items-stretch justify-between w-full">
                <div className="flex flex-col sm:flex-row gap-4 flex-1">
                  <div className="relative flex-1">
                    <span className="absolute inset-y-0 left-4 flex items-center text-slate-500">🔍</span>
                    <input
                      type="text"
                      placeholder="ค้นหาชื่อเกมในคลังของคุณ..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="glass-input w-full h-11 pl-11 pr-4 text-sm rounded-xl focus:outline-none"
                    />
                  </div>
                  
                  {/* Library Tag Filter Button & Dropdown */}
                  <div className="relative w-full sm:w-56 library-tag-filter-container">
                    <button
                      type="button"
                      onClick={() => setShowTagFilterLibrary(!showTagFilterLibrary)}
                      className={`glass-input w-full h-11 px-4 text-sm rounded-xl flex items-center justify-between cursor-pointer transition-colors ${
                        selectedLibraryTags.length > 0 ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'text-slate-400'
                      }`}
                    >
                      <span className="truncate">
                        {selectedLibraryTags.length > 0 ? `ตัวกรองแท็ก (${selectedLibraryTags.length})` : '🔍 เลือกแท็กแนวเกม...'}
                      </span>
                      <span className="text-xs">▼</span>
                    </button>
                    
                    {showTagFilterLibrary && (
                      <div className="absolute left-0 mt-2 w-72 solid-dropdown rounded-2xl shadow-2xl z-50 p-4 animate-fade-in-up">
                        <input
                          type="text"
                          placeholder="พิมพ์ค้นหาแท็ก..."
                          value={libraryTagSearch}
                          onChange={(e) => setLibraryTagSearch(e.target.value)}
                          className="glass-input w-full h-8 px-2.5 text-xs rounded-lg mb-3"
                        />
                        
                        <div className="max-h-48 overflow-y-auto flex flex-col gap-2 pr-1 scrollbar-thin">
                          {allUniqueLibraryTags
                            .filter(tag => tag.toLowerCase().includes(libraryTagSearch.toLowerCase()))
                            .map(tag => {
                              const isChecked = selectedLibraryTags.includes(tag);
                              return (
                                <label key={tag} className="flex items-center gap-2.5 text-xs text-slate-300 hover:text-slate-100 cursor-pointer py-0.5">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      if (isChecked) {
                                        setSelectedLibraryTags(selectedLibraryTags.filter(t => t !== tag));
                                      } else {
                                        setSelectedLibraryTags([...selectedLibraryTags, tag]);
                                      }
                                    }}
                                    className="w-4 h-4 accent-blue-500 rounded border-slate-700 bg-slate-900 cursor-pointer"
                                  />
                                  <span className="font-medium">#{tag}</span>
                                </label>
                              );
                            })}
                          {allUniqueLibraryTags.filter(tag => tag.toLowerCase().includes(libraryTagSearch.toLowerCase())).length === 0 && (
                            <div className="text-center text-slate-550 py-3 text-xs italic">ไม่พบชื่อแท็กนี้</div>
                          )}
                        </div>
                        
                        <div className="mt-3.5 pt-2 border-t border-slate-900/60 flex justify-between gap-2">
                          {selectedLibraryTags.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setSelectedLibraryTags([])}
                              className="text-[10px] font-bold text-red-400 hover:underline cursor-pointer"
                            >
                              ล้างทั้งหมด
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowTagFilterLibrary(false)}
                            className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white text-[10px] font-bold px-3 py-1 rounded-md ml-auto cursor-pointer"
                          >
                            ปิด
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => {
                      if (isGuest) {
    
                        setIsAuthModalOpen(true);
                        setToastMessage('กรุณาลงชื่อเข้าใช้เพื่อส่งคำขอเพิ่มเกม');
                      } else {
                        openSuggestNew();
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 h-11 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-blue-500/25 active:scale-95 text-xs cursor-pointer justify-center animate-fade-in"
                  >
                    ➕ เสนอแนะขอเพิ่มเกมยอดนิยม
                  </button>
                </div>
              </div>

              {/* Status Filters */}
              <div className="flex flex-col gap-2 pb-1.5">
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                  <button
                    onClick={() => setLibraryStatusFilter('All')}
                    className={`px-4 py-2 text-xs font-bold rounded-full border transition-all shrink-0 cursor-pointer ${
                      libraryStatusFilter === 'All'
                        ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/20'
                        : 'bg-slate-900/40 border-slate-850 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    ทั้งหมด ({currentLibraryList.length})
                  </button>
                  {STATUS_CATEGORIES.map((cat) => {
                    const count = currentLibraryList.filter((item) => item.status === cat).length;
                    return (
                      <button
                        key={cat}
                        onClick={() => setLibraryStatusFilter(cat)}
                        className={`px-4 py-2 text-xs font-bold rounded-full border transition-all shrink-0 cursor-pointer ${
                          libraryStatusFilter === cat
                            ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/20'
                            : 'bg-slate-900/40 border-slate-850 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {cat} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* My Library Vertical Grid of Cards */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-extrabold text-slate-500">แสดงคลังข้อมูล {filteredLibrary.length} รายการ</span>
              </div>

              {filteredLibrary.length === 0 ? (
                <div className="text-center py-20 glass-panel rounded-3xl border border-slate-900">
                  <span className="text-4xl block mb-2">📚</span>
                  <p className="text-slate-450 font-bold text-sm">ไม่พบเกมตามเงื่อนไขในคลังส่วนตัวของคุณ</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {filteredLibrary.map((item) => {
                    const origGame = officialGames.find((og) => og.id === item.gameId);
                    return (
                      <div
                        key={item.gameId}
                        onClick={() => {
                          handleOpenGameDetail(origGame || {
                            id: item.gameId,
                            title: item.title,
                            developer: item.developer,
                            version: item.version,
                            overview: item.overview,
                            tags: item.tags,
                            rating: item.rating || 5,
                            coverUrl: item.coverUrl,
                            patreonUrl: item.patreonUrl,
                            buyUrl: item.buyUrl,
                            socialUrl: item.socialUrl,
                            screenshots: item.screenshots || []
                          });
                        }}
                        className="glass-card-minimal rounded-3xl overflow-hidden flex flex-col cursor-pointer group relative"
                      >
                        {/* Cover Image aspect-[3/4] */}
                        <div className="aspect-[3/4] w-full overflow-hidden relative custom-placeholder">
                          {item.coverUrl ? (
                            <img
                              src={item.coverUrl}
                              alt={item.title}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-black text-slate-600 text-2xl">
                              {getInitials(item.title)}
                            </div>
                          )}
                          
                          {/* Badges on cover */}
                          <div className="absolute top-3 right-3 bg-slate-955/90 backdrop-blur border border-white/10 px-2 py-0.5 rounded-lg text-xs font-extrabold text-blue-400">
                            v{item.version}
                          </div>

                          {origGame && isVersionOlder(item.version, origGame.version) && (
                            <div className="absolute top-10 right-3 bg-red-650/95 backdrop-blur border border-red-500/20 px-2 py-0.5 rounded-lg text-[9px] font-black text-white uppercase tracking-wider animate-pulse shadow-lg shadow-red-500/20">
                              อัปเดตใหม่ v{origGame.version}
                            </div>
                          )}
                          
                          {item.isCustom && (
                            <div className="absolute top-3 left-3 bg-amber-500/90 backdrop-blur border border-white/10 px-2 py-0.5 rounded-lg text-[9px] font-black text-white uppercase tracking-wider">
                              กำหนดเอง
                            </div>
                          )}
                        </div>

                        {/* Card Body */}
                        <div className="p-4.5 flex flex-col flex-1 gap-2.5">
                          <div>
                            <h3 className="text-base font-extrabold text-slate-100 truncate group-hover:text-blue-400 transition-colors" title={item.title}>
                              {item.title}
                            </h3>
                            <span className="text-xs text-slate-455 font-semibold block mt-0.5">โดย {item.developer}</span>
                          </div>

                          {/* Inline Controls */}
                          <div className="flex flex-col gap-2 pt-1 border-t border-slate-900/60">
                            
                            {/* Status selector */}
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={item.status}
                                onChange={(e) => handleUpdateItemStatus(item.gameId, e.target.value)}
                                className={`h-8 px-2.5 text-xs font-bold rounded-lg border cursor-pointer w-full focus:ring-1 focus:ring-blue-500/20 bg-black text-white ${
                                  STATUS_COLORS[item.status] || 'text-slate-400 border-slate-900'
                                }`}
                              >
                                {STATUS_CATEGORIES.map((cat) => (
                                  <option key={cat} value={cat} className="bg-black text-white">
                                    {cat}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Playtime and Star Rating */}
                            <div className="flex items-center justify-between gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5 text-xs text-slate-455">
                                <span className="font-bold">เวลา:</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  value={item.playTime || 0}
                                  onChange={(e) => handleUpdateItemPlayTime(item.gameId, e.target.value)}
                                  className="glass-input w-12 h-7 text-center rounded-lg text-slate-200 text-xs focus:outline-none"
                                />
                                <span className="font-bold">ชม.</span>
                              </div>
                              
                              <div className="flex items-center">
                                {renderReviewStars(item.rating || 0, true, (rating) => handleUpdateItemRating(item.gameId, rating))}
                              </div>
                            </div>

                            {/* Quick Note Input */}
                            <div className="w-full" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="text"
                                value={item.notes || ''}
                                onChange={(e) => handleUpdateItemNotes(item.gameId, e.target.value)}
                                className="glass-input w-full px-2.5 py-1.5 text-[11px] rounded-lg text-slate-350 placeholder-slate-600 focus:outline-none"
                                placeholder="พิมพ์โน้ตย่อด่วน..."
                              />
                            </div>
                          </div>

                          {/* Action Buttons (Text only, no emoji icons only) */}
                          <div className="flex items-center justify-between gap-1 mt-auto pt-2.5 border-t border-slate-900/60" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => openEditLocalItem(item)}
                              className="flex-grow py-1 px-1 text-[11px] font-black rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-850 hover:border-slate-700 text-slate-300 transition-colors cursor-pointer text-center"
                            >
                              แก้ไข
                            </button>
                            <button
                              onClick={() => openReportGame(item)}
                              className="flex-grow py-1 px-1 text-[11px] font-black rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-850 hover:border-slate-700 text-amber-450 transition-colors cursor-pointer text-center"
                            >
                              รายงาน
                            </button>
                            <button
                              onClick={() => {
                                setCustomConfirm({
                                  title: 'ลบเกมออกจากคลังส่วนตัว',
                                  message: 'คุณต้องการลบเกมนี้ออกจากคลังประวัติส่วนตัวหรือไม่?',
                                  onConfirm: () => {
                                    handleDeleteLibraryItem(item.gameId);
                                  }
                                });
                              }}
                              className="flex-grow py-1 px-1 text-[11px] font-black rounded-lg bg-red-955/25 border border-red-900/30 hover:bg-red-900/40 hover:border-red-750/50 text-red-400 transition-colors cursor-pointer text-center"
                            >
                              ลบเกม
                            </button>
                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

              </div>
            )
          )}

        {/* ADMIN TAB */}
        {activeTab === 'admin' && isAdmin && (
          <div className="flex flex-col gap-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                ⚙️ แผงควบคุมแอดมิน (Admin Control Panel)
              </h2>
              {isFirebaseEnabled && (
                <button
                  onClick={() => fetchAdminData(false)}
                  disabled={isRefreshingAdmin}
                  className="px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-850 hover:text-white transition-all duration-200 disabled:opacity-50 flex items-center gap-1.5 shadow-lg cursor-pointer"
                >
                  <svg className={`w-3.5 h-3.5 ${isRefreshingAdmin ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M21 8h-5" />
                  </svg>
                  {isRefreshingAdmin ? 'กำลังโหลด...' : 'รีโหลดข้อมูลแอดมิน'}
                </button>
              )}
            </div>
            {/* API URL Diagnostic Banner */}
            <div className="glass-panel p-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 flex flex-col gap-1.5">
              <h4 className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                🔍 ลิงก์ API ที่กำลังใช้งานจริงในขณะนี้ (Active API URL):
              </h4>
              <p className="text-xs font-mono text-slate-300 break-all select-all bg-black/40 p-2.5 rounded-lg border border-slate-800">
                {getApiUrl()}
              </p>
              <p className="text-[10px] text-slate-400">
                *หากลิงก์ด้านบนไม่ตรงกับรุ่นที่คุณดีพลอยมาใหม่ ให้เลื่อนลงไปที่ "เชื่อมต่อระบบฐานข้อมูล Google Sheets" ด้านล่าง แล้วป้อนลิงก์ใหม่ จากนั้นกด "บันทึกและรีโหลดหน้าเว็บ"
              </p>
            </div>
            {!isFirebaseEnabled && (
              <div className="glass-panel p-5.5 rounded-3xl border border-amber-500/20 bg-amber-500/5 flex flex-col gap-3">
                <h4 className="text-sm font-bold text-amber-400 flex items-center gap-1.5">
                  ⚠️ ระบบกำลังรันในโหมดจำลอง (Local Simulation Mode)
                </h4>
                <p className="text-xs text-slate-400 leading-normal">
                  ฐานข้อมูล Google Sheets ยังไม่ได้เชื่อมต่อ หากคุณต้องการเปิดใช้งานระบบออนไลน์ (บัญชีผู้ใช้จริง คลังเก็บข้อมูลกลาง ประวัติการเงิน และรายงานต่างๆ) กรุณากรอก URL ของเว็บแอปด้านล่างนี้:
                </p>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={googleSheetsUrl}
                    onChange={(e) => setGoogleSheetsUrlState(e.target.value)}
                    className="glass-input flex-1 h-10 px-3.5 text-xs rounded-xl text-slate-200"
                    placeholder="ป้อน URL ของ Google Sheets API..."
                  />
                  <button
                    onClick={() => {
                      if (!googleSheetsUrl) return;
                      updateGoogleSheetsUrl(googleSheetsUrl);
                    }}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold h-10 px-5 rounded-xl cursor-pointer transition-colors"
                  >
                    ⚡ เชื่อมต่อฐานข้อมูลออนไลน์
                  </button>
                </div>
              </div>
            )}
            
            {/* System Stats Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="glass-panel p-5.5 rounded-2xl flex items-center gap-4.5 border-l-4 border-l-blue-500">
                <span className="text-3xl bg-blue-500/10 w-12 h-12 rounded-xl flex items-center justify-center">👥</span>
                <div>
                  <span className="text-slate-400 text-xs font-bold block mb-0.5">ผู้ใช้งานทั้งหมด</span>
                  <span className="text-2xl font-black text-slate-100">{Object.keys(userRoles).length}</span>
                </div>
              </div>
              <div className="glass-panel p-5.5 rounded-2xl flex items-center gap-4.5 border-l-4 border-l-emerald-500">
                <span className="text-3xl bg-emerald-500/10 w-12 h-12 rounded-xl flex items-center justify-center">🎮</span>
                <div>
                  <span className="text-slate-400 text-xs font-bold block mb-0.5">เกมทั้งหมดในระบบ</span>
                  <span className="text-2xl font-black text-slate-100">{officialGames.length}</span>
                </div>
              </div>
              <div className="glass-panel p-5.5 rounded-2xl flex items-center gap-4.5 border-l-4 border-l-amber-500">
                <span className="text-3xl bg-amber-500/10 w-12 h-12 rounded-xl flex items-center justify-center">🚩</span>
                <div>
                  <span className="text-slate-400 text-xs font-bold block mb-0.5">รายงานรออนุมัติ</span>
                  <span className="text-2xl font-black text-slate-100">
                    {reports.filter(r => r.status === 'pending').length}
                  </span>
                </div>
              </div>
            </div>

            {/* Financial Analytics Dashboard */}
            <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
              <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                📊 ระบบวิเคราะห์รายได้และการเงิน (Financial Analytics)
              </h3>
              
              {/* Financial Stats Cards */}
              {(() => {
                const totalRevenue = revenueTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
                
                // Count active premium users and calculate MRR
                const activePremiumCount = Object.keys(userRoles).filter(user => {
                  const role = userRoles[user];
                  if (role !== 'premium') return false;
                  
                  // Check if expired
                  const sub = userPremiumDates[user];
                  if (sub && sub.expiryDate) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const expiry = new Date(sub.expiryDate);
                    expiry.setHours(0, 0, 0, 0);
                    return today <= expiry;
                  }
                  return true;
                }).length;
                
                // MRR calculation based on active packages
                let monthlyCount = 0;
                let yearlyCount = 0;
                
                Object.keys(userRoles).forEach(user => {
                  if (userRoles[user] === 'premium') {
                    const userTx = revenueTransactions.find(tx => tx.username === user && tx.status === 'success');
                    if (userTx && userTx.package === 'yearly') {
                      yearlyCount++;
                    } else {
                      monthlyCount++;
                    }
                  }
                });
                
                const mrrValue = (monthlyCount * 49) + (yearlyCount * (499 / 12));
                const totalPlans = monthlyCount + yearlyCount;
                const monthlyPct = totalPlans > 0 ? Math.round((monthlyCount / totalPlans) * 100) : 0;
                const yearlyPct = totalPlans > 0 ? 100 - monthlyPct : 0;

                return (
                  <div className="flex flex-col gap-6">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-slate-955/40 border border-slate-900 p-4.5 rounded-2xl flex flex-col gap-1">
                        <span className="text-slate-400 text-xs font-bold block">💰 รายได้สะสมทั้งหมด</span>
                        <span className="text-xl font-black text-amber-400">{totalRevenue.toLocaleString()} บาท</span>
                        <span className="text-[10px] text-slate-500">จากการสแกนจ่ายจำลอง</span>
                      </div>
                      
                      <div className="bg-slate-955/40 border border-slate-900 p-4.5 rounded-2xl flex flex-col gap-1">
                        <span className="text-slate-400 text-xs font-bold block">📈 รายได้รายเดือนเฉลี่ย (MRR)</span>
                        <span className="text-xl font-black text-emerald-400">{mrrValue.toFixed(2)} บาท/เดือน</span>
                        <span className="text-[10px] text-slate-500">คำนวณตามแพ็กเกจ active</span>
                      </div>

                      <div className="bg-slate-955/40 border border-slate-900 p-4.5 rounded-2xl flex flex-col gap-1">
                        <span className="text-slate-400 text-xs font-bold block">👑 สมาชิก Premium ปัจจุบัน</span>
                        <span className="text-xl font-black text-blue-400">{activePremiumCount} บัญชี</span>
                        <span className="text-[10px] text-slate-500">จากบัญชีทั้งหมดในระบบ</span>
                      </div>
                    </div>

                    {/* Plan ratio bar */}
                    <div className="bg-slate-955/20 border border-slate-900/50 p-4.5 rounded-2xl flex flex-col gap-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-350">สัดส่วนผู้ใช้แพ็กเกจ Premium</span>
                        <span className="text-slate-400">
                          รายเดือน: {monthlyCount} ({monthlyPct}%) | รายปี: {yearlyCount} ({yearlyPct}%)
                        </span>
                      </div>
                      
                      <div className="h-4 w-full bg-slate-955 rounded-full overflow-hidden flex border border-slate-900">
                        {totalPlans === 0 ? (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-650 font-bold bg-slate-955">
                            ไม่มีสมาชิก Premium ในขณะนี้
                          </div>
                        ) : (
                          <>
                            {monthlyCount > 0 && (
                              <div 
                                style={{ width: `${monthlyPct}%` }} 
                                className="h-full bg-blue-600 transition-all duration-500" 
                                title={`รายเดือน: ${monthlyCount} บัญชี`}
                              />
                            )}
                            {yearlyCount > 0 && (
                              <div 
                                style={{ width: `${yearlyPct}%` }} 
                                className="h-full bg-amber-500 transition-all duration-500" 
                                title={`รายปี: ${yearlyCount} บัญชี`}
                              />
                            )}
                          </>
                        )}
                      </div>
                      
                      {totalPlans > 0 && (
                        <div className="flex gap-4 text-[10px] font-bold mt-1">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded bg-blue-600 inline-block"/>
                            <span className="text-slate-400">แพ็กเกจรายเดือน (49 บาท)</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block"/>
                            <span className="text-slate-400">แพ็กเกจรายปี (499 บาท)</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Transactions Header & Controls */}
                    <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-455">📝 ประวัติรายการธุรกรรมการเงินล่าสุด ({filteredTransactions.length})</h4>
                      
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <div className="relative flex-1 sm:flex-initial">
                          <input
                            type="text"
                            placeholder="ค้นหารหัส/Ref/บัญชี..."
                            value={adminTxSearch}
                            onChange={(e) => setAdminTxSearch(e.target.value)}
                            className="glass-input h-9 px-3 pl-8 text-xs rounded-xl focus:outline-none w-full sm:w-48"
                          />
                          <span className="absolute left-2.5 top-2 text-slate-500 text-xs">🔍</span>
                        </div>
                        
                        <select
                          value={adminTxStatusFilter}
                          onChange={(e) => setAdminTxStatusFilter(e.target.value)}
                          className="glass-input h-9 px-2 text-xs rounded-xl bg-black text-white cursor-pointer"
                        >
                          <option value="All" className="bg-black text-white">ทุกสถานะ</option>
                          <option value="success" className="bg-black text-white">🟢 สำเร็จ</option>
                          <option value="pending" className="bg-black text-white">🟡 รอตรวจสอบ</option>
                          <option value="failed" className="bg-black text-white">🔴 ล้มเหลว</option>
                        </select>
                      </div>
                    </div>

                    {/* Transactions Table */}
                    <div>
                      <div className="overflow-x-auto border border-slate-900 rounded-2xl bg-slate-955/20 max-h-60 scrollbar-thin">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-900 bg-slate-950/40 text-slate-400 font-bold sticky top-0 backdrop-blur">
                              <th className="p-3 pl-4">รหัสธุรกรรม</th>
                              <th className="p-3">Ref ธนาคาร</th>
                              <th className="p-3">บัญชีผู้สมัคร</th>
                              <th className="p-3">แพ็กเกจ</th>
                              <th className="p-3 text-center">จำนวนยอดโอน</th>
                              <th className="p-3">วันและเวลาชำระเงิน</th>
                              <th className="p-3 text-center">สถานะ</th>
                              <th className="p-3 text-right pr-4">การจัดการ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-900/40">
                            {filteredTransactions.length === 0 ? (
                              <tr>
                                <td colSpan="8" className="text-center py-6 text-slate-500 italic">
                                  ไม่พบข้อมูลธุรกรรมตามเงื่อนไขค้นหา
                                </td>
                              </tr>
                            ) : (
                              filteredTransactions.map((tx) => (
                                <tr key={tx.id} className="hover:bg-slate-900/20 transition-colors">
                                  <td className="p-3 pl-4 font-mono text-[10px] text-slate-450">{tx.id}</td>
                                  <td className="p-3 font-mono text-[10px] text-slate-400">{tx.transRef || '-'}</td>
                                  <td className="p-3 font-bold text-slate-200">{tx.email}</td>
                                  <td className="p-3">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      tx.package === 'yearly' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                    }`}>
                                      {tx.package === 'yearly' ? 'รายปี' : 'รายเดือน'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-center font-bold text-slate-200">{tx.amount} บาท</td>
                                  <td className="p-3 text-slate-455">{formatThaiDate(tx.timestamp)}</td>
                                  <td className="p-3 text-center">
                                    {tx.status === 'success' ? (
                                      <span className="bg-emerald-500/15 text-emerald-400 font-bold px-2 py-0.5 rounded-full text-[10px] border border-emerald-500/20 whitespace-nowrap">
                                        🟢 สำเร็จ
                                      </span>
                                    ) : tx.status === 'pending' ? (
                                      <span className="bg-amber-500/15 text-amber-400 font-bold px-2 py-0.5 rounded-full text-[10px] border border-amber-500/20 whitespace-nowrap animate-pulse" title="สลิปรอการตรวจสอบ">
                                        🟡 รอตรวจสอบ
                                      </span>
                                    ) : (
                                      <span className="bg-red-500/15 text-red-400 font-bold px-2 py-0.5 rounded-full text-[10px] border border-red-500/20 whitespace-nowrap" title={tx.reason || 'ทำรายการไม่สำเร็จ'}>
                                        🔴 ล้มเหลว
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-right pr-4">
                                    <div className="inline-flex gap-1.5 justify-end items-center">
                                      <button
                                        onClick={() => setSelectedAdminTxSlip(tx)}
                                        className="px-2 py-1 bg-slate-850 hover:bg-slate-750 text-slate-200 border border-slate-800 font-bold rounded text-[9px] cursor-pointer transition-colors"
                                        title="ตรวจสอบรายละเอียดสลิปและล็อกความผิดพลาด"
                                      >
                                        🔍 ดูสลิป
                                      </button>
                                      {tx.status === 'pending' && (
                                        <>
                                          <button
                                            onClick={() => handleAdminApproveTx(tx)}
                                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-[9px] cursor-pointer transition-colors"
                                            title="อนุมัติการชำระเงินและปรับสิทธิ์พรีเมียม"
                                          >
                                            อนุมัติ
                                          </button>
                                          <button
                                            onClick={() => handleAdminRejectTx(tx)}
                                            className="px-2 py-1 bg-red-650 hover:bg-red-550 text-white font-bold rounded text-[9px] cursor-pointer transition-colors"
                                            title="ปฏิเสธสลิปรายการนี้"
                                          >
                                            ปฏิเสธ
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* User Management Table */}
            <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
              <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                👥 การจัดการบัญชีผู้ใช้งาน (User Management)
              </h3>
              <p className="text-[11px] text-slate-400 leading-normal">
                แผงควบคุมสำหรับจัดการบทบาทสมาชิก (Admin, Premium, User) หรือลบผู้ใช้ที่ผิดกฎระเบียบออกจากระบบข้อมูล Google Sheets
              </p>
              
              {/* Form to add Gmail user and Search User */}
              <div className="flex flex-col sm:flex-row gap-2.5 justify-between">
                <div className="flex gap-2 flex-1 max-w-sm">
                  <input
                    type="text"
                    value={newGmailInput}
                    onChange={(e) => setNewGmailInput(e.target.value)}
                    className="glass-input flex-1 h-10 px-3.5 text-xs rounded-xl text-slate-200"
                    placeholder="ป้อน Gmail เช่น member.test@gmail.com..."
                  />
                  <button
                    onClick={() => {
                      handleAddGmailUser(newGmailInput);
                      setNewGmailInput('');
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 rounded-xl cursor-pointer transition-colors whitespace-nowrap shrink-0 flex items-center justify-center"
                  >
                    ➕ เพิ่มผู้ใช้
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={adminUserSearch}
                    onChange={(e) => setAdminUserSearch(e.target.value)}
                    className="glass-input w-full sm:w-48 h-10 pl-9 pr-3.5 text-xs rounded-xl text-slate-200"
                    placeholder="ค้นหาสมาชิก/Gmail..."
                  />
                  <span className="absolute left-3.5 top-3.5 text-slate-500 text-xs">🔍</span>
                </div>
              </div>
              
              <div className="overflow-x-auto border border-slate-900 rounded-2xl bg-slate-955/20 max-h-60 scrollbar-thin">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-900 bg-slate-950/40 text-slate-400 font-bold sticky top-0 backdrop-blur">
                      <th className="p-3 pl-4">อีเมลผู้ใช้งาน</th>
                      <th className="p-3">บทบาทสิทธิ์ (Role)</th>
                      <th className="p-3">วันสมัคร Premium</th>
                      <th className="p-3">วันหมดอายุ Premium</th>
                      <th className="p-3 text-right pr-4">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/40">
                    {Object.keys(userRoles)
                      .filter(email => email !== 'Guest' && email !== 'Guest@guest.com' && email.toLowerCase().includes(adminUserSearch.toLowerCase()))
                      .map((email) => {
                        const role = userRoles[email];
                        const dates = userPremiumDates[email] || { signupDate: '', expiryDate: '' };
                        const isMainAdmin = email.toLowerCase() === 'pattarasak.raksanarong@gmail.com' || email.toLowerCase() === 'pattarasak.raksanrong@gmail.com';
                        
                        return (
                          <tr key={email} className="hover:bg-slate-900/20 transition-colors">
                            <td className="p-3 pl-4 font-bold text-slate-200">{email}</td>
                            <td className="p-3">
                              {isMainAdmin ? (
                                <span className="bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded text-[10px] font-bold">
                                  ผู้ดูแลระบบหลัก (Admin)
                                </span>
                              ) : (
                                <select
                                  value={role}
                                  onChange={async (e) => {
                                    const newRole = e.target.value;
                                    try {
                                      await updateUserRole(email, newRole, dates.signupDate, dates.expiryDate);
                                      setUserRoles(prev => ({ ...prev, [email]: newRole }));
                                      setToastMessage(`เปลี่ยนบทบาท ${email} เป็น ${newRole} สำเร็จ!`);
                                    } catch (err) {
                                      alert(`❌ ไม่สามารถอัปเดตบทบาทได้: ${err.message}`);
                                    }
                                  }}
                                  className="glass-input h-7 px-2 text-[11px] rounded-lg bg-black text-white cursor-pointer border border-slate-800"
                                >
                                  <option value="user" className="bg-black text-white">user (ทั่วไป)</option>
                                  <option value="premium" className="bg-black text-white">premium (พรีเมียม)</option>
                                  <option value="admin" className="bg-black text-white">admin (ผู้ดูแลระบบ)</option>
                                </select>
                              )}
                            </td>
                            <td className="p-3 text-slate-400 font-mono text-[11px]">
                              {role === 'premium' ? (
                                <input
                                  type="date"
                                  value={dates.signupDate ? dates.signupDate.split('T')[0] : ''}
                                  onChange={async (e) => {
                                    const newDate = e.target.value;
                                    const signupDateIso = newDate ? new Date(newDate).toISOString() : '';
                                    try {
                                      await updateUserRole(email, role, signupDateIso, dates.expiryDate);
                                      setUserPremiumDates(prev => ({
                                        ...prev,
                                        [email]: { ...dates, signupDate: signupDateIso }
                                      }));
                                      setToastMessage('อัปเดตวันสมัครพรีเมียมสำเร็จ!');
                                    } catch (err) {
                                      alert(`❌ ไม่สามารถอัปเดตวันที่ได้: ${err.message}`);
                                    }
                                  }}
                                  className="glass-input px-2 py-0.5 text-[10px] rounded bg-slate-900 border border-slate-850 text-slate-200"
                                />
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="p-3 text-slate-400 font-mono text-[11px]">
                              {role === 'premium' ? (
                                <input
                                  type="date"
                                  value={dates.expiryDate ? dates.expiryDate.split('T')[0] : ''}
                                  onChange={async (e) => {
                                    const newDate = e.target.value;
                                    const expiryDateIso = newDate ? new Date(newDate).toISOString() : '';
                                    try {
                                      await updateUserRole(email, role, dates.signupDate, expiryDateIso);
                                      setUserPremiumDates(prev => ({
                                        ...prev,
                                        [email]: { ...dates, expiryDate: expiryDateIso }
                                      }));
                                      setToastMessage('อัปเดตวันหมดอายุพรีเมียมสำเร็จ!');
                                    } catch (err) {
                                      alert(`❌ ไม่สามารถอัปเดตวันที่ได้: ${err.message}`);
                                    }
                                  }}
                                  className="glass-input px-2 py-0.5 text-[10px] rounded bg-slate-900 border border-slate-850 text-slate-200"
                                />
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="p-3 text-right pr-4">
                              {!isMainAdmin && (
                                <button
                                  onClick={async () => {
                                    if (window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้งาน "${email}" ออกจากระบบถาวร? การลบนี้รวมถึงข้อมูลคลังเกมทั้งหมดของสมาชิกท่านนี้ด้วย`)) {
                                      try {
                                        await deleteUser(email);
                                        setUserRoles(prev => {
                                          const next = { ...prev };
                                          delete next[email];
                                          return next;
                                        });
                                        setUserPremiumDates(prev => {
                                          const next = { ...prev };
                                          delete next[email];
                                          return next;
                                        });
                                        setToastMessage(`ลบผู้ใช้งาน ${email} เรียบร้อยแล้ว!`);
                                      } catch (err) {
                                        alert(`❌ ไม่สามารถลบผู้ใช้งานได้: ${err.message}`);
                                      }
                                    }
                                  }}
                                  className="px-2 py-1 bg-red-650 hover:bg-red-550 text-white font-bold rounded text-[10px] cursor-pointer transition-colors"
                                >
                                  🗑️ ลบผู้ใช้
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Announcement Ticker and Admin actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Ticker settings */}
              <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
                <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                  📢 การจัดการแถบวิ่งประกาศ
                </h3>
                <div className="flex flex-col gap-3.5 flex-1 justify-between">
                  <div className="flex flex-col gap-3.5">
                    <div>
                      <label className="text-xs text-slate-400 font-bold block mb-1">ข้อความประกาศวิ่ง</label>
                      <input
                        type="text"
                        value={tempTickerMessage}
                        onChange={(e) => setTempTickerMessage(e.target.value)}
                        className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                        placeholder="พิมพ์หัวข้อหรือคำเตือนวิ่งประกาศ..."
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="show-ticker"
                        checked={tempShowTicker}
                        onChange={(e) => setTempShowTicker(e.target.checked)}
                        className="w-5 h-5 accent-blue-500 rounded border border-slate-700 bg-slate-900 cursor-pointer"
                      />
                      <label htmlFor="show-ticker" className="text-sm font-semibold text-slate-355 cursor-pointer">
                        เปิดใช้งานแถบประกาศบนเว็บไซต์
                      </label>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setTickerMessage(tempTickerMessage);
                      setShowTicker(tempShowTicker);
                      setToastMessage('บันทึกและปรับปรุงแถบประกาศวิ่งสำเร็จ!');
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold h-10 px-5 rounded-xl cursor-pointer transition-all self-start"
                  >
                    💾 บันทึกการเปลี่ยนแปลง
                  </button>
                </div>
              </div>
              
              {/* Supabase API Details */}
              <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
                <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                  📊 เชื่อมต่อระบบฐานข้อมูล Google Sheets
                </h3>
                <div className="flex flex-col gap-3.5">
                  <p className="text-[11px] text-slate-400 leading-normal">
                    ระบุ URL ของ Google Apps Script Web App ที่ดีพลอยมาจาก Google Sheet เพื่อซิงก์ข้อมูลคลังเกม บัญชีสมาชิก และข้อมูลธุรกรรมทั้งหมดออนไลน์
                  </p>
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">Supabase API URL</label>
                    <input
                      type="text"
                      value={googleSheetsUrl}
                      onChange={(e) => setGoogleSheetsUrlState(e.target.value)}
                      className="glass-input w-full h-10 px-3 text-xs rounded-xl text-slate-200"
                      placeholder="https://script.google.com/macros/s/.../exec"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!googleSheetsUrl) {
                          alert('กรุณากรอก URL ก่อนกดทดสอบ');
                          return;
                        }
                        setIsDbConnecting(true);
                        try {
                          const originalUrl = getApiUrl();
                          setApiUrl(googleSheetsUrl);
                          const connected = await testConnection();
                          if (connected) {
                            alert('🟢 เชื่อมต่อกับ Google Sheets สำเร็จ! โครงสร้างระบบฐานข้อมูลทำงานปกติ');
                          } else {
                            setApiUrl(originalUrl);
                            alert('❌ เชื่อมต่อไม่สำเร็จ: กรุณาตรวจสอบ URL หรือการตั้งค่าสิทธิ์เข้าถึงของ Web App (ต้องตั้งเป็น Anyone)');
                          }
                        } catch (e) {
                          alert('❌ เชื่อมต่อไม่สำเร็จ: ' + e.message);
                        } finally {
                          setIsDbConnecting(false);
                        }
                      }}
                      disabled={isDbConnecting}
                      className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold h-10 px-4 rounded-xl cursor-pointer transition-colors"
                    >
                      {isDbConnecting ? 'กำลังทดสอบ...' : '⚡ ทดสอบการเชื่อมต่อ'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateGoogleSheetsUrl(googleSheetsUrl);
                      }}
                      className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold h-10 px-4 rounded-xl cursor-pointer transition-colors"
                    >
                      💾 บันทึกและรีโหลดหน้าเว็บ
                    </button>
                  </div>
                </div>
              </div>

              {/* Website settings */}
              <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
                <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                  ⚙️ ตั้งค่าระบบเว็บไซต์
                </h3>
                <div className="flex flex-col gap-3.5">
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">ชื่อเว็บไซต์ (Title)</label>
                    <input
                      type="text"
                      value={webTitle}
                      onChange={(e) => setWebTitle(e.target.value)}
                      className="glass-input w-full h-10 px-3 text-xs rounded-xl text-slate-200"
                      placeholder="พิมพ์ชื่อเว็บไซต์..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">คำอธิบายเว็บไซต์ (Meta Description)</label>
                    <textarea
                      value={webMetaDescription}
                      onChange={(e) => setWebMetaDescription(e.target.value)}
                      className="glass-input w-full h-14 p-3 text-xs rounded-xl text-slate-200 resize-none"
                      placeholder="พิมพ์คำอธิบายเว็บไซต์สำหรับระบบค้นหา (SEO)..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">คำโปรย / สโลแกนเว็บไซต์</label>
                    <input
                      type="text"
                      value={webTagline}
                      onChange={(e) => setWebTagline(e.target.value)}
                      className="glass-input w-full h-10 px-3 text-xs rounded-xl text-slate-200"
                      placeholder="พิมพ์คำโปรยเว็บไซต์..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">ประเภทโลโก้</label>
                    <select
                      value={webLogoType}
                      onChange={(e) => setWebLogoType(e.target.value)}
                      className="glass-input w-full h-10 px-3 text-xs rounded-xl bg-black text-white cursor-pointer"
                    >
                      <option value="text" className="bg-black text-white">โลโก้ข้อความ</option>
                      <option value="image" className="bg-black text-white">โลโก้รูปภาพ</option>
                    </select>
                  </div>
                  {webLogoType === 'text' ? (
                    <div>
                      <label className="text-xs text-slate-400 font-bold block mb-1">ตัวอักษรโลโก้</label>
                      <input
                        type="text"
                        value={webLogo.startsWith('data:image') ? 'AVN' : webLogo}
                        onChange={(e) => setWebLogo(e.target.value)}
                        className="glass-input w-full h-10 px-3 text-xs rounded-xl text-slate-200"
                        placeholder="พิมพ์ตัวอักษรโลโก้..."
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs text-slate-400 font-bold block mb-1">อัปโหลดไฟล์รูปภาพโลโก้</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          accept="image/*"
                          id="logo-upload-input"
                          onChange={async (e) => {
                            const file = e.target.files[0];
                            if (file) {
                              try {
                                const base64 = await readFileAsBase64(file);
                                setWebLogo(base64);
                                setToastMessage('อัปโหลดไฟล์รูปภาพโลโก้สำเร็จ!');
                              } catch {
                                setToastMessage('อัปโหลดรูปภาพล้มเหลว');
                              }
                            }
                          }}
                          className="hidden"
                        />
                        <label
                          htmlFor="logo-upload-input"
                          className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl cursor-pointer transition-colors"
                        >
                          เลือกรูปภาพ...
                        </label>
                        {webLogo && webLogo.startsWith('data:image') && (
                          <img src={webLogo} alt="Logo preview" className="w-8 h-8 rounded-lg object-cover border border-white/10" />
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">หมายเลข PromptPay (เบอร์โทรศัพท์ หรือเลขบัตรประชาชน)</label>
                    <input
                      type="text"
                      value={promptPayId}
                      onChange={(e) => setPromptPayId(e.target.value)}
                      className="glass-input w-full h-10 px-3 text-xs rounded-xl text-slate-200"
                      placeholder="เช่น 0812345678"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">SlipOK API Key</label>
                    <input
                      type="text"
                      value={slipOkApiKey}
                      onChange={(e) => setSlipOkApiKey(e.target.value)}
                      className="glass-input w-full h-10 px-3 text-xs rounded-xl text-slate-200"
                      placeholder="พิมพ์ API Key ของ SlipOK..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">SlipOK Branch ID</label>
                    <input
                      type="text"
                      value={slipOkBranchId}
                      onChange={(e) => setSlipOkBranchId(e.target.value)}
                      className="glass-input w-full h-10 px-3 text-xs rounded-xl text-slate-200"
                      placeholder="พิมพ์ Branch ID ของ SlipOK..."
                    />
                  </div>

                </div>
                <button
                  type="button"
                  onClick={handleSaveSystemConfig}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold h-10 px-4 rounded-xl cursor-pointer transition-colors self-start mt-2"
                >
                  💾 บันทึกการตั้งค่าระบบ
                </button>
              </div>

              {/* Game Engagement Panel */}
              <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                    📊 แผงวิเคราะห์ความสนใจเกม (Game Engagement)
                  </h3>
                  {isFirebaseEnabled && (
                    <button
                      onClick={() => fetchEngagementData(false)}
                      disabled={isRefreshingEngage}
                      className="text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                      {isRefreshingEngage ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                          <span>กำลังซิงค์...</span>
                        </>
                      ) : (
                        <span>🔄 ซิงค์ข้อมูล</span>
                      )}
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-3 flex-1 justify-between">
                  <p className="text-[11px] text-slate-400 leading-normal">
                    แสดงยอดผู้เล่นที่ดึงเข้าคลัง และคะแนนรีวิวเฉลี่ยจากผู้ใช้งานทั้งหมดในระบบ {isFirebaseEnabled ? '(ซิงค์จากฐานข้อมูลคลาวด์)' : '(แสดงข้อมูลจำลอง)'}
                  </p>

                  {/* Filters and Search */}
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="🔍 ค้นหาชื่อเกม/ผู้พัฒนา..."
                      value={engageSearch}
                      onChange={(e) => setEngageSearch(e.target.value)}
                      className="glass-input h-9 px-3 text-xs rounded-xl text-slate-200 w-full"
                    />
                    <select
                      value={engageSort}
                      onChange={(e) => setEngageSort(e.target.value)}
                      className="glass-input h-9 px-2 text-xs rounded-xl bg-black text-white cursor-pointer w-full"
                    >
                      <option value="engage-desc">👤 ยอดเข้าคลัง (มาก → น้อย)</option>
                      <option value="engage-asc">👤 ยอดเข้าคลัง (น้อย → มาก)</option>
                      <option value="views-desc">👁️ ยอดคนดู (มาก → น้อย)</option>
                      <option value="views-asc">👁️ ยอดคนดู (น้อย → มาก)</option>
                      <option value="rating-desc">⭐ คะแนนรีวิว (สูง → ต่ำ)</option>
                      <option value="rating-asc">⭐ คะแนนรีวิว (ต่ำ → สูง)</option>
                    </select>
                  </div>

                  {/* Game List Display */}
                  <div className="bg-slate-950/80 border border-slate-900 rounded-xl p-2 h-44 overflow-y-auto flex flex-col gap-1.5 scrollbar-thin">
                    {filteredEngagement.length === 0 ? (
                      <span className="text-slate-600 italic text-[11px] p-2 text-center">ไม่พบข้อมูลสถิติเกม</span>
                    ) : (
                      filteredEngagement.map((game) => (
                        <div key={game.id} className="flex items-center justify-between p-1.5 rounded-lg hover:bg-slate-900/40 transition-colors border border-white/0 hover:border-white/5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-6 h-8 rounded overflow-hidden shrink-0 border border-white/10">
                              {game.coverUrl ? (
                                <img src={game.coverUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-slate-900 flex items-center justify-center text-[7px] font-black text-slate-500">
                                  {game.title ? game.title.substring(0, 2).toUpperCase() : 'VN'}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-200 truncate" title={game.title}>{game.title}</div>
                              <div className="text-[10px] text-slate-400 truncate">{game.developer}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" title="ยอดเข้าชม">
                              👁️ {game.viewCount}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400" title="ยอดเข้าคลัง">
                              👤 {game.engageCount}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                              game.ratingCount > 0 
                                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' 
                                : 'bg-slate-900 border-slate-800 text-slate-500'
                            }`} title="คะแนนเฉลี่ย">
                              ★ {game.averageUserRating}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <button
                    onClick={handleExportEngagementCsv}
                    className="h-10 px-4 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/15 flex items-center justify-center gap-2 cursor-pointer transition-all w-full animate-fade-in"
                  >
                    <span>📤 ส่งออกรายงาน CSV (ภาษาไทย)</span>
                  </button>
                </div>
              </div>

              {/* Full System Backup & Restore */}
              <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
                <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                  💾 สำรองและกู้คืนข้อมูลระบบ (System Backup & Restore)
                </h3>
                <div className="flex flex-col gap-3.5 flex-1 justify-between">
                  <p className="text-[11px] text-slate-400 leading-normal">
                    ดาวน์โหลดหรือนำเข้าข้อมูลโครงสร้างทั้งหมดของแอปพลิเคชัน (รวมถึงแคตตาล็อกหลัก, บัญชีผู้ใช้, สิทธิ์ Premium, รายการธุรกรรม, และประวัติคลังข้อมูลของทุกคน) ในรูปแบบไฟล์ JSON
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const backupData = {
                            avn_current_user_v7: currentUser,
                            avn_user_roles_v9: userRoles,
                            avn_user_premium_dates_v9: userPremiumDates,
                            avn_official_games_v9: officialGames,
                            avn_user_libraries_v7: userLibraries,
                            avn_reports_v7: reports,
                            avn_global_tags_v9: globalTags,
                            avn_web_title_v8: webTitle,
                            avn_web_meta_desc_v9: webMetaDescription,
                            avn_web_tagline_v9: webTagline,
                            avn_web_logo_v8: webLogo,
                            avn_web_logo_type_v8: webLogoType,
                            avn_ticker_message_v7: tickerMessage,
                            avn_show_ticker_v7: showTicker,
                            avn_revenue_transactions_v9: revenueTransactions
                          };
                          
                          const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
                            JSON.stringify(backupData, null, 2)
                          )}`;
                          const downloadAnchor = document.createElement('a');
                          const date = new Date().toISOString().slice(0, 10);
                          downloadAnchor.setAttribute('href', jsonString);
                          downloadAnchor.setAttribute('download', `avn_star_hub_system_backup_${date}.json`);
                          document.body.appendChild(downloadAnchor);
                          downloadAnchor.click();
                          downloadAnchor.remove();
                          setToastMessage('ส่งออกข้อมูลสำรองระบบสำเร็จ!');
                        } catch {
                          alert('เกิดข้อผิดพลาดในการสำรองข้อมูลระบบ');
                        }
                      }}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold h-10 px-4 rounded-xl cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                    >
                      📤 ส่งออกข้อมูลระบบ (JSON)
                    </button>
                    
                    <div className="flex-1 relative">
                      <input
                        type="file"
                        accept=".json"
                        id="system-backup-import"
                        onChange={(e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            try {
                              const parsed = JSON.parse(event.target.result);
                              
                              if ((!parsed.avn_official_games_v9 && !parsed.avn_official_games_v8 && !parsed.avn_official_games_v7) || !parsed.avn_user_libraries_v7 || !parsed.avn_user_roles_v9) {
                                alert('รูปแบบไฟล์ข้อมูลสำรองระบบไม่ถูกต้อง ไม่พบโครงสร้างฐานข้อมูลหลัก');
                                return;
                              }
                              
                              setCustomConfirm({
                                title: 'กู้คืนข้อมูลระบบหลัก',
                                message: '⚠️ คำเตือน: การกู้คืนข้อมูลระบบจะเขียนทับข้อมูลและค่าตั้งค่าทั้งหมดในปัจจุบัน คุณแน่ใจที่จะดำเนินการต่อหรือไม่?',
                                onConfirm: () => {
                                  if (parsed.avn_official_games_v9) setOfficialGames(parsed.avn_official_games_v9);
                                  else if (parsed.avn_official_games_v8) setOfficialGames(parsed.avn_official_games_v8);
                                  else if (parsed.avn_official_games_v7) setOfficialGames(parsed.avn_official_games_v7);
                                  if (parsed.avn_user_libraries_v7) setUserLibraries(parsed.avn_user_libraries_v7);
                                  if (parsed.avn_user_roles_v9) setUserRoles(parsed.avn_user_roles_v9);
                                  if (parsed.avn_user_premium_dates_v9) setUserPremiumDates(parsed.avn_user_premium_dates_v9);
                                  if (parsed.avn_reports_v7) setReports(parsed.avn_reports_v7);
                                  if (parsed.avn_global_tags_v9) setGlobalTags(parsed.avn_global_tags_v9);
                                  if (parsed.avn_web_title_v8) setWebTitle(parsed.avn_web_title_v8);
                                  if (parsed.avn_web_meta_desc_v9) setWebMetaDescription(parsed.avn_web_meta_desc_v9);
                                  if (parsed.avn_web_tagline_v9) setWebTagline(parsed.avn_web_tagline_v9);
                                  if (parsed.avn_web_logo_v8) setWebLogo(parsed.avn_web_logo_v8);
                                  if (parsed.avn_web_logo_type_v8) setWebLogoType(parsed.avn_web_logo_type_v8);
                                  if (parsed.avn_ticker_message_v7) setTickerMessage(parsed.avn_ticker_message_v7);
                                  if (parsed.avn_show_ticker_v7) setShowTicker(parsed.avn_show_ticker_v7);
                                  if (parsed.avn_revenue_transactions_v9) setRevenueTransactions(parsed.avn_revenue_transactions_v9);
                                  
                                  setToastMessage('⚡ กู้คืนข้อมูลระบบทั้งหมดสำเร็จแล้ว!');
                                }
                              });
                            } catch {
                              alert('เกิดข้อผิดพลาดในการอ่านไฟล์ JSON กรุณาตรวจสอบไฟล์');
                            }
                          };
                          reader.readAsText(file);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                      <label
                        htmlFor="system-backup-import"
                        className="w-full bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-750 text-slate-300 text-xs font-bold h-10 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-1.5"
                      >
                        📥 นำเข้าข้อมูลระบบ (JSON)
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Inbox Reports Manager */}
            <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
              <div className="flex justify-between items-center border-b border-slate-900 pb-3">
                <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                  📥 กล่องข้อร้องเรียนและเสนอแนะ ({reports.filter(r => r.status === 'pending').length})
                </h3>

                <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl">
                  <button
                    onClick={() => setAdminReportTab('update')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      adminReportTab === 'update' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    อัปเดตเวอร์ชัน ({pendingUpdates.length})
                  </button>
                  <button
                    onClick={() => setAdminReportTab('error')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      adminReportTab === 'error' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ข้อมูลผิดพลาด ({pendingErrors.length})
                  </button>
                  <button
                    onClick={() => setAdminReportTab('new')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      adminReportTab === 'new' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    เสนอเกมใหม่ ({pendingNews.length})
                  </button>
                </div>
              </div>

              {/* Inbox lists */}
              <div className="flex flex-col gap-3">
                {/* 1. UPDATE TAB */}
                {adminReportTab === 'update' && (
                  pendingUpdates.length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs">ไม่มีรายการการร้องเรียนเสนออัปเดต</div>
                  ) : (
                    pendingUpdates.map((r) => (
                      <div key={r.id} className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-xs">
                        <div className="flex-grow">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-slate-200 text-sm">{r.gameTitle}</span>
                            <span className="text-[10px] text-slate-400">จาก v{r.currentVersion} ➔ <span className="text-emerald-455 font-bold">v{r.reportedVersion}</span></span>
                          </div>
                          <p className="mt-1 text-slate-400 italic">" {r.description} "</p>
                          <span className="text-[10px] text-slate-500 block mt-2">รายงานโดย: {r.username} เมื่อ {formatThaiDate(r.timestamp)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0 self-end sm:self-center">
                          <button
                            onClick={() => handleApproveReport(r)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            อนุมัติ
                          </button>
                          <button
                            onClick={() => handleIgnoreReport(r.id)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            เพิกเฉย
                          </button>
                          <button
                            onClick={() => handleRejectReport(r.id)}
                            className="bg-red-950/45 hover:bg-red-900/50 text-red-400 border border-red-900/30 font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            ปฏิเสธ
                          </button>
                        </div>
                      </div>
                    ))
                  )
                )}

                {/* 2. ERROR TAB */}
                {adminReportTab === 'error' && (
                  pendingErrors.length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs">ไม่มีรายการร้องเรียนข้อผิดพลาดข้อมูล</div>
                  ) : (
                    pendingErrors.map((r) => (
                      <div key={r.id} className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-xs">
                        <div className="flex-grow">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-extrabold text-slate-200 text-sm">{r.gameTitle}</span>
                            <span className="bg-red-500/10 text-red-400 font-bold px-1.5 py-0.5 rounded text-[10px] uppercase">
                              {r.errorStatus || 'ผิดพลาด'}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-400 italic">" {r.description} "</p>
                          {r.reportUrls && (
                            <span className="text-[10px] text-blue-400 block mt-1">แหล่งอ้างอิง: <a href={r.reportUrls} target="_blank" rel="noreferrer" className="underline">{r.reportUrls}</a></span>
                          )}
                          {r.reportTags && (
                            <span className="text-[10px] text-slate-400 block mt-1">แท็กที่ควรเพิ่ม: {r.reportTags}</span>
                          )}
                          <span className="text-[10px] text-slate-500 block mt-2">รายงานโดย: {r.username} เมื่อ {formatThaiDate(r.timestamp)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0 self-end sm:self-center">
                          <button
                            onClick={() => handleApproveReport(r)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            อนุมัติ
                          </button>
                          <button
                            onClick={() => handleIgnoreReport(r.id)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            เพิกเฉย
                          </button>
                          <button
                            onClick={() => handleRejectReport(r.id)}
                            className="bg-red-955/45 hover:bg-red-900/50 text-red-400 border border-red-900/30 font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            ปฏิเสธ
                          </button>
                        </div>
                      </div>
                    ))
                  )
                )}

                {/* 3. NEW TAB */}
                {adminReportTab === 'new' && (
                  pendingNews.length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs">ไม่มีรายการร้องเรียนเสนอเกมใหม่</div>
                  ) : (
                    pendingNews.map((r) => (
                      <div key={r.id} className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-xs">
                        <div className="flex-grow">
                          <span className="font-extrabold text-slate-200 text-sm">{r.gameTitle}</span>
                          <span className="text-slate-450 ml-2">โดย {r.developer} (v{r.reportedVersion})</span>
                          <p className="mt-1 text-slate-450">เรื่องย่อเสนอแนะ: {r.overview}</p>
                          <span className="text-[10px] text-slate-500 block mt-2">ร้องขอโดย: {r.username} เมื่อ {formatThaiDate(r.timestamp)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0 self-end sm:self-center">
                          <button
                            onClick={() => handleApproveReport(r)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            อนุมัติ
                          </button>
                          <button
                            onClick={() => handleIgnoreReport(r.id)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            เพิกเฉย
                          </button>
                          <button
                            onClick={() => handleRejectReport(r.id)}
                            className="bg-red-955/45 hover:bg-red-900/50 text-red-400 border border-red-900/30 font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            ปฏิเสธ
                          </button>
                        </div>
                      </div>
                    ))
                  )
                )}
              </div>
            </div>

            {/* Catalog Manager Table */}
            <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                  🗄️ ตัวจัดการแคตตาล็อกระบบหลัก ({officialGames.length})
                </h3>

                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                  {selectedAdminGameIds.length > 0 && (
                    <button
                      onClick={handleSendBulkUpdateNotification}
                      className="bg-amber-600 hover:bg-amber-500 text-white font-bold px-4 h-10 rounded-xl flex items-center gap-1.5 text-xs transition-all cursor-pointer shrink-0 animate-fade-in shadow-lg shadow-amber-900/20"
                    >
                      📢 ส่งแจ้งเตือนอัปเดต ({selectedAdminGameIds.length} เกม) ให้สมาชิก Premium
                    </button>
                  )}
                  <input
                    type="text"
                    placeholder="ค้นหาชื่อเกมเพื่อจัดการ..."
                    value={adminCatalogSearch}
                    onChange={(e) => {
                      setAdminCatalogSearch(e.target.value);
                      setSelectedAdminGameIds([]);
                    }}
                    className="glass-input h-10 px-4 text-xs rounded-xl focus:outline-none w-full sm:w-64"
                  />
                  <button
                    onClick={() => {
                      handleResetAdminForm();
                      setAdminFormMode('add');
                      setAdminAddGameOpen(true);
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 h-10 rounded-xl flex items-center gap-1.5 text-xs transition-all cursor-pointer shrink-0 animate-fade-in"
                  >
                    ➕ เพิ่มเกมใหม่
                  </button>

                  <div className="relative shrink-0 animate-fade-in">
                    <input
                      type="file"
                      accept=".json"
                      id="admin-import-games-json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          try {
                            const importedGames = JSON.parse(event.target.result);
                            
                            // Validate that it's an array and check basic structure
                            if (!Array.isArray(importedGames)) {
                              alert('รูปแบบไฟล์ไม่ถูกต้อง คาดหวังข้อมูลที่เป็น Array ของเกม');
                              return;
                            }
                            
                            if (importedGames.length > 0 && (!importedGames[0].title || !importedGames[0].id)) {
                              alert('รูปแบบไฟล์ไม่ถูกต้อง ข้อมูลในอาร์เรย์ต้องมีฟิลด์ title และ id/slug');
                              return;
                            }
                            
                            setCustomConfirm({
                              title: 'นำเข้าข้อมูลแคตตาล็อก',
                              message: `คุณต้องการนำเข้าเกมจำนวน ${importedGames.length} รายการจากไฟล์นี้หรือไม่?\n(เกมที่มีชื่อหรือ ID/Slug ซ้ำจะถูกเขียนทับด้วยข้อมูลจากไฟล์นี้)`,
                              onConfirm: () => {
                                setOfficialGames(prev => {
                                  const merged = [...prev];
                                  let addedCount = 0;
                                  let updatedCount = 0;
                                  
                                  importedGames.forEach(newGame => {
                                    const idx = merged.findIndex(g => 
                                      g.id.toLowerCase() === newGame.id.toLowerCase() || 
                                      g.title.trim().toLowerCase() === newGame.title.trim().toLowerCase()
                                    );
                                    
                                    const mapped = {
                                      id: newGame.id,
                                      title: newGame.title,
                                      developer: newGame.developer || 'Unknown',
                                      version: newGame.version || '0.1.0',
                                      overview: newGame.overview || '',
                                      patreonUrl: newGame.patreonUrl || '',
                                      buyUrl: newGame.buyUrl || '',
                                      socialUrl: newGame.socialUrl || '',
                                      tags: newGame.tags || [],
                                      rating: typeof newGame.rating === 'number' ? newGame.rating : 5.0,
                                      coverUrl: newGame.coverUrl || '',
                                      screenshots: newGame.screenshots || []
                                    };
                                    
                                    if (idx !== -1) {
                                      merged[idx] = { ...merged[idx], ...mapped };
                                      updatedCount++;
                                    } else {
                                      merged.push(mapped);
                                      addedCount++;
                                    }

                                    if (isFirebaseEnabled) {
                                      saveOfficialGame(mapped)
                                        .catch(err => console.error('Error saving imported game to Firestore:', err));
                                    }
                                  });
                                  
                                  alert(`นำเข้าข้อมูลเรียบร้อยแล้ว!\n- อัปเดตข้อมูลเกมเดิม: ${updatedCount} รายการ\n- เพิ่มเกมใหม่: ${addedCount} รายการ`);
                                  return merged;
                                });
                              }
                            });
                          } catch (err) {
                            alert('เกิดข้อผิดพลาดในการอ่านไฟล์ JSON: ' + err.message);
                          }
                        };
                        reader.readAsText(file);
                        // Reset input value to allow uploading same file again
                        e.target.value = '';
                      }}
                    />
                    <label
                      htmlFor="admin-import-games-json"
                      className="bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-200 font-bold px-4 h-10 rounded-xl flex items-center justify-center gap-1.5 text-xs transition-all cursor-pointer shrink-0"
                    >
                      📥 นำเข้าแคตตาล็อก (JSON)
                    </label>
                  </div>
                </div>
              </div>

              {/* Table Container */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-900 text-slate-400 font-bold">
                      <th className="pb-3 pl-2 w-10">
                        <input
                          type="checkbox"
                          checked={
                            adminCatalogPaginatedList.length > 0 &&
                            adminCatalogPaginatedList.every((game) => selectedAdminGameIds.includes(game.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              const visibleIds = adminCatalogPaginatedList.map((g) => g.id);
                              setSelectedAdminGameIds((prev) => {
                                const newSelection = new Set([...prev, ...visibleIds]);
                                return Array.from(newSelection);
                              });
                            } else {
                              const visibleIds = adminCatalogPaginatedList.map((g) => g.id);
                              setSelectedAdminGameIds((prev) =>
                                prev.filter((id) => !visibleIds.includes(id))
                              );
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-800 text-blue-600 focus:ring-blue-500 bg-slate-900 cursor-pointer"
                        />
                      </th>
                      <th className="pb-3">รูปปก</th>
                      <th className="pb-3">ชื่อเกม</th>
                      <th className="pb-3">ผู้พัฒนา</th>
                      <th className="pb-3">เวอร์ชัน</th>
                      <th className="pb-3">คะแนนรีวิว</th>
                      <th className="pb-3 text-right pr-2">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/60">
                    {adminCatalogPaginatedList.map((game) => (
                      <tr key={game.id} className="hover:bg-slate-900/30 transition-colors">
                        <td className="py-2.5 pl-2 w-10">
                          <input
                            type="checkbox"
                            checked={selectedAdminGameIds.includes(game.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedAdminGameIds((prev) => [...prev, game.id]);
                              } else {
                                setSelectedAdminGameIds((prev) =>
                                  prev.filter((id) => id !== game.id)
                                );
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-800 text-blue-600 focus:ring-blue-500 bg-slate-900 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5">
                          <div className="w-8 h-10 rounded-lg overflow-hidden custom-placeholder border border-white/5">
                            {game.coverUrl ? (
                              <img src={game.coverUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[8px] font-black text-slate-650">
                                {getInitials(game.title)}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 font-bold text-slate-200">{game.title}</td>
                        <td className="py-2.5 text-slate-400">{game.developer}</td>
                        <td className="py-2.5 text-blue-400 font-extrabold">v{game.version}</td>
                        <td className="py-2.5 font-bold text-amber-400">★ {game.rating.toFixed(1)}</td>
                        <td className="py-2.5 text-right pr-2">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => handleSendUpdateNotification(game)}
                              className="w-7 h-7 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 rounded flex items-center justify-center cursor-pointer"
                              title="แจ้งเตือนอัปเดตไปยังผู้ใช้ Premium"
                            >
                              📢
                            </button>
                            <button
                              onClick={() => {
                                handleSelectGameForEdit(game);
                                setAdminEditGameOpen(true);
                              }}
                              className="w-7 h-7 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 flex items-center justify-center cursor-pointer"
                              title="แก้ไขเกม"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteOfficialGame(game.id)}
                              className="w-7 h-7 bg-red-955/25 border border-red-900/30 text-red-400 hover:bg-red-900/40 rounded flex items-center justify-center cursor-pointer"
                              title="ลบเกม"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {adminCatalogTotalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-900/60 pt-4 mt-2 gap-3">
                  <div className="text-xs text-slate-400">
                    แสดง {(adminCatalogPage - 1) * adminCatalogPageSize + 1} - {Math.min(adminCatalogPage * adminCatalogPageSize, adminFilteredCatalog.length)} จาก {adminFilteredCatalog.length} เกม
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setAdminCatalogPage(1)}
                      disabled={adminCatalogPage === 1}
                      className="px-2.5 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs font-bold cursor-pointer"
                    >
                      หน้าแรก
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdminCatalogPage(prev => Math.max(prev - 1, 1))}
                      disabled={adminCatalogPage === 1}
                      className="px-2.5 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs font-bold flex items-center justify-center cursor-pointer"
                    >
                      ‹ ย้อนกลับ
                    </button>
                    
                    {/* Render page numbers */}
                    {Array.from({ length: adminCatalogTotalPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === adminCatalogTotalPages || Math.abs(p - adminCatalogPage) <= 1)
                      .map((p, idx, arr) => {
                        const showEllipsisBefore = idx > 0 && p - arr[idx - 1] > 1;
                        return (
                          <Fragment key={p}>
                            {showEllipsisBefore && <span className="text-slate-655 text-xs px-1 select-none">...</span>}
                            <button
                              type="button"
                              onClick={() => setAdminCatalogPage(p)}
                              className={`w-8 h-8 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                adminCatalogPage === p
                                  ? 'bg-blue-600 text-white font-extrabold shadow-lg shadow-blue-500/20'
                                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {p}
                            </button>
                          </Fragment>
                        );
                      })}

                    <button
                      type="button"
                      onClick={() => setAdminCatalogPage(prev => Math.min(prev + 1, adminCatalogTotalPages))}
                      disabled={adminCatalogPage === adminCatalogTotalPages}
                      className="px-2.5 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs font-bold flex items-center justify-center cursor-pointer"
                    >
                      ถัดไป ›
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdminCatalogPage(adminCatalogTotalPages)}
                      disabled={adminCatalogPage === adminCatalogTotalPages}
                      className="px-2.5 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs font-bold cursor-pointer"
                    >
                      หน้าสุดท้าย
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Translated Games Management Panel */}
            <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                    🇹🇭 จัดการบทความเกมแปลไทย ({translatedGames.length})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    จัดการข้อมูลหน้าปกเกม อัปเดตเนื้อหาบทความความคืบหน้างานแปล และลิงก์ดาวน์โหลดสำหรับเกมแปลไทย
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsAddTranslatedOpen(true);
                  }}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 h-10 rounded-xl flex items-center gap-1.5 text-xs transition-all cursor-pointer shrink-0"
                >
                  ➕ เขียนบทความแปลไทยใหม่
                </button>
              </div>

              <div className="overflow-x-auto mt-2">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-900 text-slate-400 font-bold">
                      <th className="pb-3 pl-2 w-16">ปกเกม</th>
                      <th className="pb-3">ชื่อเกม</th>
                      <th className="pb-3 w-32">เวอร์ชันงานแปล</th>
                      <th className="pb-3 w-44">ตัวอย่างเนื้อหา</th>
                      <th className="pb-3 text-right pr-2 w-28">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {translatedGames.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="py-6 text-center text-slate-500 italic">
                          ยังไม่มีข้อมูลบทความแปลไทย (รันอยู่ในโหมดพรีวิวโลคัล)
                        </td>
                      </tr>
                    ) : (
                      translatedGames.map((game) => (
                        <tr key={game.id} className="border-b border-slate-900/50 hover:bg-slate-900/10 text-slate-350">
                          <td className="py-2.5 pl-2">
                            <div className="w-8 h-10 bg-slate-950 rounded-md overflow-hidden border border-white/5">
                              {game.cover_url ? (
                                <img src={game.cover_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-slate-900 flex items-center justify-center font-bold text-[9px]">
                                  NO
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 font-bold text-slate-200">
                            {game.title}
                          </td>
                          <td className="py-2.5">
                            <span className="bg-blue-950 text-blue-400 border border-blue-500/20 text-[9px] font-bold px-2 py-0.5 rounded-md">
                              {game.version}
                            </span>
                          </td>
                          <td className="py-2.5 text-[10px] text-slate-400 max-w-[200px] truncate pr-4">
                            {game.description ? game.description.replace(/\n/g, ' ').substring(0, 50) + '...' : '-'}
                          </td>
                          <td className="py-2.5 text-right pr-2">
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  setEditingTranslatedGame(game);
                                  setIsEditTranslatedOpen(true);
                                }}
                                className="bg-slate-900 hover:bg-slate-800 border border-slate-850 hover:border-slate-700 text-blue-400 text-[10px] font-bold h-7 px-2.5 rounded-lg cursor-pointer transition-colors"
                              >
                                ✏️ แก้ไข
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`คุณต้องการลบบทความเกม "${game.title}" หรือไม่?`)) {
                                    deleteTranslatedGame(game.id).then(() => {
                                      const updated = translatedGames.filter(g => g.id !== game.id);
                                      setTranslatedGames(updated);
                                      setToastMessage('ลบบทความเรียบร้อยแล้ว!');
                                    }).catch(err => {
                                      console.error(err);
                                      alert('เกิดข้อผิดพลาดในการลบข้อมูล: ' + err.message);
                                    });
                                  }
                                }}
                                className="bg-rose-950/20 hover:bg-rose-900/30 border border-rose-500/10 hover:border-rose-500/30 text-rose-400 text-[10px] font-bold h-7 px-2.5 rounded-lg cursor-pointer transition-colors"
                              >
                                🗑️ ลบ
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tag Management Panel */}
            <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
              <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                🏷️ การจัดการแท็กระบบ (#Tag Manager)
              </h3>
              <p className="text-[11px] text-slate-400">
                เพิ่มหรือลบแท็กหมวดหมู่ระบบเพื่อใช้เป็นปุ่มแท็กด่วนในการเพิ่ม/แก้ไขระบบของแอดมิน
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  className="glass-input flex-1 h-9 px-3 text-xs rounded-xl text-slate-200"
                  placeholder="พิมพ์แท็กใหม่ เช่น Sandbox..."
                />
                <button
                  onClick={() => {
                    if (!newTagInput.trim()) return;
                    const formatted = newTagInput.trim();
                    if (globalTags.some(t => t.toLowerCase() === formatted.toLowerCase())) {
                      setToastMessage('มีแท็กนี้ในระบบอยู่แล้ว');
                      return;
                    }
                    setGlobalTags(prev => [...prev, formatted].sort());
                    setNewTagInput('');
                    setToastMessage(`เพิ่มแท็ก #${formatted} สำเร็จ!`);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 rounded-xl cursor-pointer transition-all shrink-0"
                >
                  เพิ่มแท็ก
                </button>
              </div>
              <div className="flex flex-wrap gap-2 overflow-y-auto max-h-56 pr-1 mt-1 scrollbar-thin">
                {globalTags.map((tag) => (
                  <div
                    key={tag}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold bg-slate-900 border border-slate-800 rounded-lg text-slate-300"
                  >
                    <span>#{tag}</span>
                    <button
                      onClick={() => {
                        setGlobalTags(prev => prev.filter(t => t !== tag));
                        setToastMessage(`ลบแท็ก #${tag} แล้ว`);
                      }}
                      className="text-red-400 hover:text-red-500 cursor-pointer font-bold focus:outline-none"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* BANNERS MANAGEMENT PANEL (ADMIN) */}
            <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                    📢 จัดการแบนเนอร์ประกาศ ({banners.length})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    เพิ่ม ลบ หรือแก้ไขแบนเนอร์ที่แสดงที่หน้าแรก (รองรับแบบธรรมดา ลิงก์เกมแนะนำ และกิจกรรมโหวต)
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditingBanner(null);
                    setBannerFormType('normal');
                    setBannerFormTitle('');
                    setBannerFormSubtitle('');
                    setBannerFormCoverUrl('');
                    setBannerFormBgGradient('from-blue-955/70 to-indigo-950/70');
                    setBannerFormLinkUrl('');
                    setBannerFormTargetGameId('');
                    setBannerFormIsActive(true);
                    setBannerFormSortOrder(0);
                    setIsAddBannerOpen(true);
                  }}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 h-10 rounded-xl flex items-center gap-1.5 text-xs transition-all cursor-pointer shrink-0"
                >
                  สร้างแบนเนอร์ใหม่
                </button>
              </div>

              <div className="overflow-x-auto mt-2">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 font-bold">ชื่อ / รายละเอียด</th>
                      <th className="py-2.5 font-bold">ประเภท</th>
                      <th className="py-2.5 font-bold">พื้นหลัง</th>
                      <th className="py-2.5 font-bold">เป้าหมายลิงก์</th>
                      <th className="py-2.5 font-bold">สถานะ</th>
                      <th className="py-2.5 font-bold text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {banners.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="py-8 text-center text-slate-500">
                          ไม่มีข้อมูลแบนเนอร์ในระบบ
                        </td>
                      </tr>
                    ) : (
                      banners.map((banner) => (
                        <tr key={banner.id} className="border-b border-slate-900 hover:bg-slate-900/10">
                          <td className="py-3">
                            <div className="flex items-center gap-3">
                              {banner.cover_url && (
                                <img src={banner.cover_url} className="w-8 h-10 object-cover rounded-lg" alt="" />
                              )}
                              <div>
                                <span className="font-extrabold text-slate-200 block text-xs">{banner.title}</span>
                                <span className="text-[10px] text-slate-400 block line-clamp-1 max-w-[200px]">{banner.subtitle}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3">
                            <span className="text-[10px] font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-350">
                              {banner.type === 'normal' && '📢 ประกาศ'}
                              {banner.type === 'game_promo' && '🔥 แนะนำเกม'}
                              {banner.type === 'voting' && '🗳️ กิจกรรมโหวต'}
                            </span>
                          </td>
                          <td className="py-3 font-mono text-[10px] text-slate-400">
                            {banner.bg_gradient}
                          </td>
                          <td className="py-3 text-[10px] text-slate-400 truncate max-w-[150px]">
                            {banner.type === 'normal' && (banner.link_url || 'ไม่มี')}
                            {banner.type === 'game_promo' && (banner.target_game_id || 'สุ่มเกมในระบบ')}
                            {banner.type === 'voting' && 'หน้าโหวตแปลเกม'}
                          </td>
                          <td className="py-3">
                            <span className={`text-[10px] font-bold ${banner.is_active ? 'text-emerald-450' : 'text-slate-500'}`}>
                              {banner.is_active ? '🟢 เปิดใช้งาน' : '🔴 ปิด'}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => {
                                  setEditingBanner(banner);
                                  setBannerFormType(banner.type);
                                  setBannerFormTitle(banner.title);
                                  setBannerFormSubtitle(banner.subtitle || '');
                                  setBannerFormCoverUrl(banner.cover_url || '');
                                  setBannerFormBgGradient(banner.bg_gradient || 'from-blue-955/70 to-indigo-950/70');
                                  setBannerFormLinkUrl(banner.link_url || '');
                                  setBannerFormTargetGameId(banner.target_game_id || '');
                                  setBannerFormIsActive(banner.is_active);
                                  setBannerFormSortOrder(banner.sort_order || 0);
                                  setIsEditBannerOpen(true);
                                }}
                                className="bg-blue-955/20 hover:bg-blue-900/30 border border-blue-500/10 hover:border-blue-500/30 text-blue-400 text-[10px] font-bold h-7 px-2.5 rounded-lg cursor-pointer transition-colors"
                              >
                                ✏️ แก้ไข
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`คุณต้องการลบแบนเนอร์ "${banner.title}" หรือไม่?`)) {
                                    deleteBanner(banner.id).then(() => {
                                      setBanners(prev => prev.filter(b => b.id !== banner.id));
                                      setToastMessage('ลบแบนเนอร์เรียบร้อยแล้ว!');
                                    }).catch(err => {
                                      alert('เกิดข้อผิดพลาด: ' + err.message);
                                    });
                                  }
                                }}
                                className="bg-rose-955/20 hover:bg-rose-900/30 border border-rose-500/10 hover:border-rose-500/30 text-rose-400 text-[10px] font-bold h-7 px-2.5 rounded-lg cursor-pointer transition-colors"
                              >
                                🗑️ ลบ
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* VOTING CANDIDATES PANEL (ADMIN) */}
            <div className="glass-panel p-5.5 rounded-3xl flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                    🗳️ จัดการผู้ท้าชิงกิจกรรมโหวต ({votingCandidates.length})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    เพิ่ม ลบ หรือแก้ไขตัวเลือกเกมสำหรับกิจกรรมให้ผู้เล่นร่วมลงคะแนนโหวตแปลไทย
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => {
                      if (confirm('⚠️ คำเตือน: คุณต้องการล้างคะแนนโหวตของผู้เล่นทุกคนทั้งหมด เพื่อเตรียมเริ่มกิจกรรมรอบใหม่ใช่หรือไม่?')) {
                        clearTranslationVotes().then(() => {
                          setTranslationVotes([]);
                          setToastMessage('🚨 ล้างคะแนนโหวตทั้งหมดเสร็จสิ้น!');
                        }).catch(err => {
                          alert('เกิดข้อผิดพลาด: ' + err.message);
                        });
                      }
                    }}
                    className="border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 font-bold px-3.5 h-10 rounded-xl flex items-center gap-1 text-xs transition-all cursor-pointer"
                  >
                    🚨 ล้างคะแนนโหวตทั้งหมด
                  </button>
                  <button
                    onClick={() => {
                      setEditingCandidate(null);
                      setCandidateFormTitle('');
                      setCandidateFormDescription('');
                      setCandidateFormCoverUrl('');
                      setIsAddCandidateOpen(true);
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 h-10 rounded-xl flex items-center gap-1.5 text-xs transition-all cursor-pointer"
                  >
                    ➕ เพิ่มผู้ท้าชิงโหวต
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto mt-2">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 font-bold">รูปปก</th>
                      <th className="py-2.5 font-bold">ชื่อเกมผู้ท้าชิง</th>
                      <th className="py-2.5 font-bold">คำอธิบาย</th>
                      <th className="py-2.5 font-bold">ผลคะแนน (Premium / ทั่วไป)</th>
                      <th className="py-2.5 font-bold text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {votingCandidates.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="py-8 text-center text-slate-500">
                          ไม่มีข้อมูลผู้ท้าชิงโหวตในระบบ
                        </td>
                      </tr>
                    ) : (
                      votingCandidates.map((candidate) => {
                        const premiumVotes = translationVotes.filter(v => v.candidate_id === candidate.id && v.is_premium).length;
                        const normalVotes = translationVotes.filter(v => v.candidate_id === candidate.id && !v.is_premium).length;
                        const total = premiumVotes + normalVotes;

                        return (
                          <tr key={candidate.id} className="border-b border-slate-900 hover:bg-slate-900/10">
                            <td className="py-3">
                              <div className="w-10 h-14 rounded-lg overflow-hidden border border-white/5 bg-slate-900">
                                {candidate.cover_url ? (
                                  <img src={candidate.cover_url} className="w-full h-full object-cover" alt="" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center font-bold text-slate-600 text-[10px]">
                                    {getInitials(candidate.title)}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-3 font-extrabold text-slate-200">
                              {candidate.title}
                            </td>
                            <td className="py-3 text-[10px] text-slate-400 max-w-[250px] line-clamp-2 mt-1">
                              {candidate.description || 'ไม่มีคำอธิบาย'}
                            </td>
                            <td className="py-3">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-extrabold text-slate-200 font-bold">รวม {total} เสียง</span>
                                <span className="text-[10px] text-slate-500 font-medium">👑 Premium: {premiumVotes} | 👥 ทั่วไป: {normalVotes}</span>
                              </div>
                            </td>
                            <td className="py-3 text-right">
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => {
                                    setEditingCandidate(candidate);
                                    setCandidateFormTitle(candidate.title);
                                    setCandidateFormDescription(candidate.description || '');
                                    setCandidateFormCoverUrl(candidate.cover_url || '');
                                    setIsEditCandidateOpen(true);
                                  }}
                                  className="bg-blue-955/20 hover:bg-blue-900/30 border border-blue-500/10 hover:border-blue-500/30 text-blue-400 text-[10px] font-bold h-7 px-2.5 rounded-lg cursor-pointer transition-colors"
                                >
                                  ✏️ แก้ไข
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm(`คุณต้องการลบผู้ท้าชิง "${candidate.title}" ใช่หรือไม่? (คะแนนโหวตทั้งหมดของตัวเลือกนี้จะถูกลบไปด้วย)`)) {
                                      deleteVotingCandidate(candidate.id).then(() => {
                                        setVotingCandidates(prev => prev.filter(c => c.id !== candidate.id));
                                        setTranslationVotes(prev => prev.filter(v => v.candidate_id !== candidate.id));
                                        setToastMessage('ลบผู้ท้าชิงโหวตเรียบร้อยแล้ว!');
                                      }).catch(err => {
                                        alert('เกิดข้อผิดพลาด: ' + err.message);
                                      });
                                    }
                                  }}
                                  className="bg-rose-955/20 hover:bg-rose-900/30 border border-rose-500/10 hover:border-rose-500/30 text-rose-400 text-[10px] font-bold h-7 px-2.5 rounded-lg cursor-pointer transition-colors"
                                >
                                  🗑️ ลบ
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </main>

      {/* --- ALL POPUP MODALS --- */}

      {/* 1. GAME DETAIL MODAL */}
      {selectedGameDetail && (
        <div className="modal-overlay" onClick={() => setSelectedGameDetail(null)}>
          <div className="modal-content w-full max-w-2xl bg-slate-955/95 border border-slate-850 rounded-3xl p-6 relative shadow-2xl" style={{ overflowX: "hidden" }} onClick={(e) => e.stopPropagation()}>
            
            <button
              onClick={() => setSelectedGameDetail(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-850 w-9 h-9 border border-slate-800 rounded-full flex items-center justify-center cursor-pointer transition-colors"
            >
              ✕
            </button>

            {/* Content layout */}
            <div className="flex flex-col md:flex-row gap-6 w-full max-w-full min-w-0">
              {/* Left Column: Cover & Links & Tags */}
              <div className="w-full md:w-56 shrink-0 flex flex-col gap-4">
                <div className="aspect-[3/4] w-full rounded-2xl overflow-hidden custom-placeholder border border-white/5 shadow-lg relative">
                  {selectedGameDetail.coverUrl ? (
                    <img src={selectedGameDetail.coverUrl} alt={selectedGameDetail.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-black text-slate-600 text-3xl">
                      {getInitials(selectedGameDetail.title)}
                    </div>
                  )}
                  <div className="absolute top-2.5 right-2.5 bg-slate-955/85 backdrop-blur px-2 py-0.5 rounded-lg text-xs font-bold text-blue-400">
                    v{selectedGameDetail.version}
                  </div>
                </div>

                {/* External links */}
                <div className="flex flex-col gap-2">
                  {selectedGameDetail.patreonUrl && (
                    <a
                      href={selectedGameDetail.patreonUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-orange-600 hover:bg-orange-500 text-white font-bold h-10 px-4 rounded-xl flex items-center justify-center gap-1.5 text-xs transition-colors shadow shadow-orange-600/20"
                    >
                      <span>🧡 Patreon</span>
                    </a>
                  )}
                  {selectedGameDetail.buyUrl && (
                    <a
                      href={selectedGameDetail.buyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-10 px-4 rounded-xl flex items-center justify-center gap-1.5 text-xs transition-colors shadow shadow-blue-600/20"
                    >
                      <span>🛒 Steam / Buy</span>
                    </a>
                  )}
                  {selectedGameDetail.socialUrl && (
                    <a
                      href={selectedGameDetail.socialUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-sky-600 hover:bg-sky-500 text-white font-bold h-10 px-4 rounded-xl flex items-center justify-center gap-1.5 text-xs transition-colors shadow shadow-sky-600/20"
                    >
                      <span>🐦 Twitter / Social</span>
                    </a>
                  )}
                </div>

                {/* Genre Tags (moved to left column, max 5, with show more) */}
                {selectedGameDetail.tags && selectedGameDetail.tags.length > 0 && (
                  <div className="mt-2">
                    <h4 className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">แท็กประเภท (Tags):</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(() => {
                        const maxTags = 5;
                        const hasMoreTags = selectedGameDetail.tags.length > maxTags;
                        const visibleTags = showAllTags ? selectedGameDetail.tags : selectedGameDetail.tags.slice(0, maxTags);
                        
                        return (
                          <>
                            {visibleTags.map((tag) => (
                              <span key={tag} className="text-[10px] font-bold bg-slate-900/60 hover:bg-slate-900 text-blue-400/90 px-2 py-0.5 rounded-md border border-slate-850 transition-colors">
                                #{tag}
                              </span>
                            ))}
                            {hasMoreTags && (
                              <button
                                type="button"
                                onClick={() => setShowAllTags(!showAllTags)}
                                className="text-[10px] font-black text-blue-500 hover:text-blue-400 bg-slate-900/40 hover:bg-slate-900/80 px-2 py-0.5 rounded-md border border-slate-850 cursor-pointer transition-all"
                              >
                                {showAllTags ? '◀ Show Less' : `+${selectedGameDetail.tags.length - maxTags} Show More`}
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Information details */}
              <div className="flex-1 flex flex-col gap-4 min-w-0">
                
                {/* Status Dropdown next/before Game Title */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {!isGuest && (
                      <select
                        value={(() => {
                          const item = currentLibraryList.find(i => i.gameId === selectedGameDetail.id);
                          return item ? item.status : 'ยังไม่ได้เพิ่ม';
                        })()}
                        onChange={(e) => {
                          const newStatus = e.target.value;
                          if (newStatus === 'ยังไม่ได้เพิ่ม') {
                            handleDeleteLibraryItem(selectedGameDetail.id);
                          } else {
                            handleAddToLibrary(selectedGameDetail, newStatus);
                          }
                        }}
                        className={`h-9 px-3 text-xs font-bold rounded-lg border cursor-pointer bg-black text-white ${
                          currentLibraryList.some(i => i.gameId === selectedGameDetail.id)
                            ? STATUS_COLORS[currentLibraryList.find(i => i.gameId === selectedGameDetail.id).status].replace(/bg-\S+/g, '')
                            : 'text-slate-400 border-slate-700'
                        }`}
                      >
                        <option value="ยังไม่ได้เพิ่ม" className="bg-black text-slate-400">➕ ยังไม่ได้เพิ่มในคลัง</option>
                        {STATUS_CATEGORIES.map(cat => (
                          <option key={cat} value={cat} className="bg-black text-slate-200">
                            {cat}
                          </option>
                        ))}
                      </select>
                    )}

                    <h2 className="text-xl md:text-2xl font-black text-slate-100">{selectedGameDetail.title}</h2>
                  </div>
                  <span className="text-xs text-slate-455 font-bold">โดย {selectedGameDetail.developer}</span>
                </div>

                {!isGuest && !isAdmin && !currentLibraryList.some(i => i.gameId === selectedGameDetail.id) && (
                  <button
                    onClick={() => handleAddToLibrary(selectedGameDetail, 'วางแผนจะเล่น')}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-10 px-4 rounded-xl flex items-center justify-center gap-1.5 text-xs transition-colors shadow-lg shadow-blue-500/20 w-full"
                  >
                    ➕ เพิ่มเกมเข้าคลัง
                  </button>
                )}

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    {renderReviewStars(selectedGameDetail.rating)}
                    <span className="text-xs font-extrabold text-slate-400">{selectedGameDetail.rating.toFixed(1)}</span>
                  </div>
                  {selectedGameDetail.viewCount !== undefined && (
                    <span className="text-xs font-bold text-slate-400 flex items-center gap-1 bg-slate-900 px-2 py-0.5 border border-slate-850 rounded-md">
                      👁️ {selectedGameDetail.viewCount.toLocaleString()} ครั้ง
                    </span>
                  )}
                </div>

                {/* Tabbed Navigation */}
                <div className="flex border-b border-slate-900 gap-6 text-xs font-extrabold text-slate-400 mt-2">
                  <button
                    type="button"
                    onClick={() => setActiveDetailTab('overview')}
                    className={`pb-2.5 cursor-pointer border-b-2 transition-all ${
                      activeDetailTab === 'overview'
                        ? 'text-blue-500 border-blue-500'
                        : 'border-transparent hover:text-slate-200'
                    }`}
                  >
                    📖 Overview
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDetailTab('screenshots')}
                    className={`pb-2.5 cursor-pointer border-b-2 transition-all ${
                      activeDetailTab === 'screenshots'
                        ? 'text-blue-500 border-blue-500'
                        : 'border-transparent hover:text-slate-200'
                    }`}
                  >
                    🖼️ Gallery
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDetailTab('changelog')}
                    className={`pb-2.5 cursor-pointer border-b-2 transition-all ${
                      activeDetailTab === 'changelog'
                        ? 'text-blue-500 border-blue-500'
                        : 'border-transparent hover:text-slate-200'
                    }`}
                  >
                    🔄 Changelog
                  </button>
                </div>

                {/* Tab Content Rendering */}
                {activeDetailTab === 'overview' && (
                  <div className="animate-fade-in">
                    <h4 className="text-xs font-bold text-slate-400 mb-1.5">เรื่องย่ออย่างย่อ:</h4>
                    <div className="text-xs text-slate-300 leading-relaxed bg-slate-900/40 border border-slate-900 p-3.5 rounded-2xl relative">
                      <p style={{ display: "-webkit-box", WebkitLineClamp: isOverviewExpanded ? "none" : 8, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {selectedGameDetail.overview || 'ไม่มีคำอธิบายสำหรับเกมนี้'}
                      </p>
                      {selectedGameDetail.overview && selectedGameDetail.overview.length > 300 && (
                        <div className={`mt-2 flex justify-end ${!isOverviewExpanded ? 'pt-1' : ''}`}>
                          <button
                            type="button"
                            onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
                            className="text-[10px] font-black text-blue-500 hover:text-blue-400 bg-slate-955 hover:bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            {isOverviewExpanded ? '◀ Show Less' : '▼ Read More'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeDetailTab === 'screenshots' && (
                  <div className="w-full max-w-full min-w-0 animate-fade-in">
                    <h4 className="text-xs font-bold text-slate-400 mb-2">ภาพตัวอย่างเกม (Screenshots):</h4>
                    {(() => {
                      const screenshotsList = (selectedGameDetail.screenshots && selectedGameDetail.screenshots.length > 0)
                        ? selectedGameDetail.screenshots
                        : (!selectedGameDetail.id.startsWith('custom-') ? OFFICIAL_SCREENSHOT_PLACEHOLDERS : []);

                      if (screenshotsList.length === 0) {
                        return (
                          <div className="text-center py-6 bg-slate-900/25 border border-dashed border-slate-800 rounded-2xl">
                            <span className="text-slate-500 text-xs block">ไม่มีภาพตัวอย่างเกม (สามารถอัปโหลดได้ในเมนูแก้ไขประวัติ)</span>
                          </div>
                        );
                      }

                      // Safeguard index bounds
                      const validIndex = activeScreenshotIndex >= screenshotsList.length ? 0 : activeScreenshotIndex;
                      const currentImg = screenshotsList[validIndex];

                      return (
                        <div className="flex flex-col gap-2">
                          {/* Large Image View */}
                          <div className="aspect-video w-full max-h-[240px] sm:max-h-[300px] rounded-2xl overflow-hidden border border-slate-800 relative group bg-slate-955/40">
                            <img
                              src={currentImg}
                              alt="screenshot large"
                              onClick={() => setActiveScreenshotPreview(currentImg)}
                              className="w-full h-full object-cover cursor-zoom-in group-hover:scale-[1.01] transition-transform duration-300"
                            />

                            {/* Left Navigation Arrow */}
                            {screenshotsList.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveScreenshotIndex((prev) => (prev === 0 ? screenshotsList.length - 1 : prev - 1));
                                }}
                                className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-955/80 hover:bg-slate-900 border border-slate-800 text-white font-bold flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 z-10"
                              >
                                &lt;
                              </button>
                            )}

                            {/* Right Navigation Arrow */}
                            {screenshotsList.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveScreenshotIndex((prev) => (prev === screenshotsList.length - 1 ? 0 : prev + 1));
                                }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-955/80 hover:bg-slate-900 border border-slate-800 text-white font-bold flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 z-10"
                              >
                                &gt;
                              </button>
                            )}

                            {/* Counter Badge */}
                            <div className="absolute bottom-3 right-3 bg-slate-955/90 backdrop-blur px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-300 border border-white/5">
                              {validIndex + 1} / {screenshotsList.length}
                            </div>
                          </div>

                          {/* Thumbnail Navigation */}
                          {screenshotsList.length > 1 && (
                            <div className="flex gap-2 overflow-x-auto py-1 scrollbar-thin w-full max-w-full min-w-0">
                              {(() => {
                                const maxThumbnails = 3;
                                const hasMore = screenshotsList.length > maxThumbnails;
                                const visibleList = (!showAllScreenshots && hasMore) 
                                  ? screenshotsList.slice(0, maxThumbnails) 
                                  : screenshotsList;

                                return visibleList.map((src, idx) => {
                                  const isLastPlaceholder = !showAllScreenshots && hasMore && idx === maxThumbnails - 1;
                                  if (isLastPlaceholder) {
                                    return (
                                      <button
                                        key={idx}
                                        type="button"
                                        onClick={() => {
                                          setShowAllScreenshots(true);
                                          setActiveScreenshotIndex(idx);
                                        }}
                                        className="w-16 sm:w-20 aspect-video rounded-lg overflow-hidden border shrink-0 transition-all border-slate-850 relative group bg-slate-955/65"
                                      >
                                        <img src={src} className="w-full h-full object-cover opacity-30" alt="" />
                                        <div className="absolute inset-0 bg-slate-955/65 flex items-center justify-center text-xs font-bold text-white group-hover:bg-slate-950/50 transition-colors">
                                          +{screenshotsList.length - (maxThumbnails - 1)}
                                        </div>
                                      </button>
                                    );
                                  }

                                  return (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => setActiveScreenshotIndex(idx)}
                                      className={`w-16 sm:w-20 aspect-video rounded-lg overflow-hidden border shrink-0 transition-all ${
                                        validIndex === idx
                                          ? 'border-blue-500 scale-95 ring-1 ring-blue-500'
                                          : 'border-slate-850 opacity-60 hover:opacity-100 hover:scale-95'
                                      }`}
                                    >
                                      <img src={src} className="w-full h-full object-cover" alt="" />
                                    </button>
                                  );
                                });
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {activeDetailTab === 'changelog' && (
                  <div className="w-full max-w-full min-w-0 animate-fade-in">
                    <h4 className="text-xs font-bold text-slate-400 mb-2">ประวัติการบันทึกรุ่น (Changelog):</h4>
                    <div className="flex flex-col gap-3 max-h-[260px] overflow-y-auto pr-1.5 scrollbar-thin">
                      {(!selectedGameDetail.versions || selectedGameDetail.versions.length === 0) ? (
                        <div className="text-center py-8 bg-slate-900/25 border border-dashed border-slate-800 rounded-2xl">
                          <span className="text-slate-500 text-xs block">ยังไม่มีประวัติการบันทึกรุ่น (Changelog) สำหรับเกมนี้</span>
                        </div>
                      ) : (
                        selectedGameDetail.versions.map((ver, idx) => (
                          <div key={ver.id || idx} className="bg-slate-900/30 border border-slate-900 p-3.5 rounded-2xl flex flex-col gap-2">
                            <div className="flex items-center justify-between border-b border-slate-850 pb-2">
                              <span className="text-xs font-black text-blue-400">รุ่น: {ver.version_number}</span>
                              {ver.release_date && (
                                <span className="text-[10px] font-bold text-slate-500">
                                  📅 {new Date(ver.release_date).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-300 whitespace-pre-line leading-relaxed pl-1">
                              {ver.changelog || 'ไม่มีรายละเอียดการอัปเดตในรุ่นนี้'}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Action footer */}
                <div className="mt-4 pt-4 pb-2 border-t border-slate-900 flex flex-col gap-2.5">
                  {!isGuest && (
                    <button
                      onClick={() => openReportGame(selectedGameDetail)}
                      className="bg-slate-900 hover:bg-slate-850 text-amber-500 font-bold border border-slate-800 px-4 h-10 rounded-xl flex items-center justify-center gap-1.5 text-xs transition-colors cursor-pointer w-full shrink-0"
                    >
                      🚩 รายงานความไม่ถูกต้อง
                    </button>
                  )}
                  
                  <button
                    onClick={() => setSelectedGameDetail(null)}
                    className="bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-850 px-5 h-10 rounded-xl font-bold text-xs cursor-pointer w-full flex items-center justify-center shrink-0"
                  >
                    ปิดหน้าต่าง
                  </button>
                </div>
                <div className="h-6 shrink-0"></div> {/* Spacer to prevent bottom overflow crop */}

              </div>
            </div>

          </div>
        </div>
      )}
      
      {/* 2. IMAGE PREVIEW OVERLAY */}
      {activeScreenshotPreview && (
        <div className="modal-overlay" onClick={() => setActiveScreenshotPreview(null)} style={{ zIndex: 999 }}>
          <div className="relative max-w-5xl max-h-[85vh] w-full flex items-center justify-center p-2" onClick={(e) => e.stopPropagation()}>
            <img
              src={activeScreenshotPreview}
              alt="Screenshot Preview"
              className="max-w-full max-h-[80vh] rounded-2xl object-contain border border-slate-800 shadow-2xl"
            />
            <button
              onClick={() => setActiveScreenshotPreview(null)}
              className="absolute -top-12 right-2 text-white bg-slate-900 border border-slate-800 w-9 h-9 rounded-full flex items-center justify-center font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 3. EDIT LOCAL GAME MODAL */}
      {editingLocalItem && (
        <div className="modal-overlay" onClick={() => setEditingLocalItem(null)}>
          <div className="modal-content w-full max-w-2xl bg-slate-955/95 border border-slate-855 rounded-3xl p-6 relative shadow-2xl" style={{ overflowX: "hidden" }} onClick={(e) => e.stopPropagation()}>
            
            <button
              onClick={() => setEditingLocalItem(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-855 w-9 h-9 border border-slate-855 rounded-full flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>

            <h2 className="text-lg font-black text-slate-100 mb-4 flex items-center gap-2">
              ✏️ แก้ไขข้อมูลประวัติและข้อมูลเกมในคลัง
            </h2>

            <form onSubmit={handleSaveLocalEdit} className="flex flex-col gap-4.5">
              
              {/* Two columns wrapper */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* 4. LOCK all fields except Notes and Playtime for official games */}
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">
                    {!editingLocalItem.isCustom && <span className="mr-1">🔒</span>}
                    ชื่อเกม
                  </label>
                  <input
                    type="text"
                    value={localTitle}
                    onChange={(e) => setLocalTitle(e.target.value)}
                    disabled={!editingLocalItem.isCustom}
                    className={`glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200 ${
                      !editingLocalItem.isCustom ? 'bg-slate-900/60 border-slate-900/80 text-slate-500 cursor-not-allowed' : ''
                    }`}
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">
                    {!editingLocalItem.isCustom && <span className="mr-1">🔒</span>}
                    ผู้พัฒนา
                  </label>
                  <input
                    type="text"
                    value={localDeveloper}
                    onChange={(e) => setLocalDeveloper(e.target.value)}
                    disabled={!editingLocalItem.isCustom}
                    className={`glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200 ${
                      !editingLocalItem.isCustom ? 'bg-slate-900/60 border-slate-900/80 text-slate-500 cursor-not-allowed' : ''
                    }`}
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">
                    {!editingLocalItem.isCustom && <span className="mr-1">🔒</span>}
                    เวอร์ชัน
                  </label>
                  <input
                    type="text"
                    value={localVersion}
                    onChange={(e) => setLocalVersion(e.target.value)}
                    disabled={!editingLocalItem.isCustom}
                    className={`glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200 ${
                      !editingLocalItem.isCustom ? 'bg-slate-900/60 border-slate-900/80 text-slate-500 cursor-not-allowed' : ''
                    }`}
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">
                    สถานะการเล่น
                  </label>
                  <select
                    value={localStatus}
                    onChange={(e) => setLocalStatus(e.target.value)}
                    className="glass-input w-full h-11 px-3 text-sm rounded-xl bg-black text-white cursor-pointer"
                  >
                    {STATUS_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat} className="bg-black text-white">
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Rating component locked / editable */}
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">
                    คะแนนความพึงพอใจ
                  </label>
                  <div className="h-11 flex items-center">
                    {renderReviewStars(
                      localRating,
                      true, // interactive always
                      (newStars) => setLocalRating(newStars)
                    )}
                  </div>
                </div>

                {/* Playtime - always editable */}
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">
                    เวลาเล่นสะสม (ชั่วโมง)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={localPlayTime}
                    onChange={(e) => setLocalPlayTime(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                  />
                </div>
              </div>

              {/* Cover Upload base64 conversion */}
              {editingLocalItem.isCustom ? (
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">อัปโหลดรูปปกปกเกมกำหนดเอง</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      accept="image/*"
                      id="cover-upload-local"
                      onChange={handleCoverUpload}
                      className="hidden"
                    />
                    <label
                      htmlFor="cover-upload-local"
                      className="bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer border border-slate-800 transition-colors shrink-0"
                    >
                      📤 อัปโหลดรูปปก
                    </label>
                    {localCoverUrl && (
                      <span className="text-[10px] text-emerald-400 font-bold">อัปโหลดไฟล์ภาพปก Base64 สำเร็จ</span>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">🔒 รูปปกเกมหลักของระบบ</label>
                  <p className="text-[10px] text-slate-500 italic">รูปปกถูกควบคุมโดยฐานข้อมูลระบบหลัก หากพบความผิดพลาดโปรดใช้ปุ่ม รายงานความไม่ถูกต้อง</p>
                </div>
              )}

              {/* Overview & Tags (locked / editable) */}
              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">
                  {!editingLocalItem.isCustom && <span className="mr-1">🔒</span>}
                  รายละเอียดเรื่องย่อ
                </label>
                <textarea
                  value={localOverview}
                  onChange={(e) => setLocalOverview(e.target.value)}
                  disabled={!editingLocalItem.isCustom}
                  className={`glass-input w-full p-4 text-sm rounded-xl h-20 text-slate-200 ${
                    !editingLocalItem.isCustom ? 'bg-slate-900/60 border-slate-900/80 text-slate-500 cursor-not-allowed' : ''
                  }`}
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">
                  {!editingLocalItem.isCustom && <span className="mr-1">🔒</span>}
                  แท็กแนวเกม (คั่นด้วยเครื่องหมายจุลภาค)
                </label>
                <input
                  type="text"
                  value={localTags}
                  onChange={(e) => setLocalTags(e.target.value)}
                  disabled={!editingLocalItem.isCustom}
                  placeholder="เช่น Action, Comedy, Fantasy"
                  className={`glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200 ${
                    !editingLocalItem.isCustom ? 'bg-slate-900/60 border-slate-900/80 text-slate-500 cursor-not-allowed' : ''
                  }`}
                />
              </div>

              {/* Notes - always editable */}
              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">บันทึกส่วนตัว / โน้ตความคืบหน้า</label>
                <textarea
                  value={localNotes}
                  onChange={(e) => setLocalNotes(e.target.value)}
                  className="glass-input w-full p-4 text-sm rounded-xl h-24 text-slate-200"
                  placeholder="พิมพ์ข้อความที่ต้องการบันทึก..."
                />
              </div>

              {/* Screenshot gallery management for custom game */}
              {editingLocalItem.isCustom && (
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">
                    อัปโหลดภาพตัวอย่างเกมกำหนดเอง (อัปโหลดเพิ่มได้สูงสุด 4 รูป)
                  </label>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        id="screenshot-upload-local"
                        multiple
                        onChange={handleScreenshotUpload}
                        className="hidden"
                        disabled={localScreenshots.length >= 4}
                      />
                      <label
                        htmlFor="screenshot-upload-local"
                        className={`text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer border transition-colors shrink-0 ${
                          localScreenshots.length >= 4
                            ? 'bg-slate-900 text-slate-650 border-slate-900 cursor-not-allowed'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-800'
                        }`}
                      >
                        📷 เลือกรูปภาพหน้าจอ
                      </label>
                      <span className="text-[10px] text-slate-500">({localScreenshots.length}/4 รูป)</span>
                    </div>

                    <div className="grid grid-cols-4 gap-2.5 mt-1">
                      {localScreenshots.map((src, index) => (
                        <div key={index} className="aspect-video border border-slate-850 rounded-xl overflow-hidden relative group">
                          <img src={src} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setLocalScreenshots(localScreenshots.filter((_, i) => i !== index))}
                            className="absolute top-1 right-1 w-5 h-5 bg-red-650 text-white rounded-full flex items-center justify-center text-[10px] cursor-pointer hover:bg-red-500"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Locked External links */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold block mb-1">
                    {!editingLocalItem.isCustom && <span className="mr-1">🔒</span>}
                    Patreon URL
                  </label>
                  <input
                    type="text"
                    value={localPatreonUrl}
                    onChange={(e) => setLocalPatreonUrl(e.target.value)}
                    disabled={!editingLocalItem.isCustom}
                    className={`glass-input w-full h-9 px-3 text-[11px] rounded-lg text-slate-200 ${
                      !editingLocalItem.isCustom ? 'bg-slate-900/60 border-slate-900/80 text-slate-500 cursor-not-allowed' : ''
                    }`}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold block mb-1">
                    {!editingLocalItem.isCustom && <span className="mr-1">🔒</span>}
                    Steam/Buy URL
                  </label>
                  <input
                    type="text"
                    value={localBuyUrl}
                    onChange={(e) => setLocalBuyUrl(e.target.value)}
                    disabled={!editingLocalItem.isCustom}
                    className={`glass-input w-full h-9 px-3 text-[11px] rounded-lg text-slate-200 ${
                      !editingLocalItem.isCustom ? 'bg-slate-900/60 border-slate-900/80 text-slate-500 cursor-not-allowed' : ''
                    }`}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold block mb-1">
                    {!editingLocalItem.isCustom && <span className="mr-1">🔒</span>}
                    Social URL
                  </label>
                  <input
                    type="text"
                    value={localSocialUrl}
                    onChange={(e) => setLocalSocialUrl(e.target.value)}
                    disabled={!editingLocalItem.isCustom}
                    className={`glass-input w-full h-9 px-3 text-[11px] rounded-lg text-slate-200 ${
                      !editingLocalItem.isCustom ? 'bg-slate-900/60 border-slate-900/80 text-slate-500 cursor-not-allowed' : ''
                    }`}
                  />
                </div>
              </div>

              {/* Submit / Cancel footer */}
              <div className="mt-4 pt-4 border-t border-slate-900 flex justify-end gap-2.5">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-10 px-5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  💾 บันทึกประวัติการเล่น
                </button>
                <button
                  type="button"
                  onClick={() => setEditingLocalItem(null)}
                  className="bg-slate-900 hover:bg-slate-855 text-slate-350 border border-slate-855 px-5 h-10 rounded-xl font-bold text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>

            </form>
          </div>
        </div>
      )}



      {/* 5. USER REPORT MODAL */}
      {isReportingGame && (
        <div className="modal-overlay" onClick={() => setIsReportingGame(null)}>
          <div className="modal-content w-full max-w-xl bg-slate-950/95 border border-slate-855 rounded-3xl p-6 relative shadow-2xl" style={{ overflowX: "hidden" }} onClick={(e) => e.stopPropagation()}>
            
            <button
              onClick={() => setIsReportingGame(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-855 w-9 h-9 border border-slate-855 rounded-full flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>

            <h2 className="text-lg font-black text-slate-100 mb-4">
              🚩 รายงานข้อมูลสำหรับเกม: <span className="text-blue-400">{isReportingGame.title}</span>
            </h2>

            {/* 6. Tabs for Version update / Error report */}
            <div className="flex border-b border-slate-900 mb-5">
              <button
                type="button"
                onClick={() => setReportType('update')}
                className={`flex-1 pb-3 text-xs font-bold text-center border-b-2 transition-all cursor-pointer ${
                  reportType === 'update' ? 'border-blue-500 text-slate-200' : 'border-transparent text-slate-400'
                }`}
              >
                รายงานอัปเดตเวอร์ชันใหม่
              </button>
              <button
                type="button"
                onClick={() => setReportType('error')}
                className={`flex-1 pb-3 text-xs font-bold text-center border-b-2 transition-all cursor-pointer ${
                  reportType === 'error' ? 'border-blue-500 text-slate-200' : 'border-transparent text-slate-400'
                }`}
              >
                รายงานข้อผิดพลาดข้อมูล
              </button>
            </div>

            <form onSubmit={handleSaveReport} className="flex flex-col gap-4">
              
              {reportType === 'update' ? (
                // UPDATE CATEGORY FIELDS
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">
                      เวอร์ชันปัจจุบันในระบบ
                    </label>
                    <input
                      type="text"
                      disabled
                      value={isReportingGame.version}
                      className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-500 bg-slate-900/60 border-slate-900/80 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">
                      เวอร์ชันใหม่ที่แนะนำ *
                    </label>
                    <input
                      type="text"
                      required
                      value={reportReportedVersion}
                      onChange={(e) => setReportReportedVersion(e.target.value)}
                      className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                      placeholder="เช่น v1.1.0 หรือ Act 2"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">
                      รายละเอียดการอัปเดต / Changelog *
                    </label>
                    <textarea
                      required
                      value={reportDescription}
                      onChange={(e) => setReportDescription(e.target.value)}
                      className="glass-input w-full p-4 text-sm rounded-xl h-24 text-slate-200"
                      placeholder="เช่น มีการอัปเดตเนื้อหาใหม่ล่าสุดบนหน้า Patreon ของผู้พัฒนา..."
                    />
                  </div>
                </div>
              ) : (
                // ERROR CATEGORY FIELDS
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">
                      ชื่อเกม (ชื่ออ้างอิง)
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={isReportingGame.title}
                      className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-500 bg-slate-900/60 border-slate-900/80 cursor-not-allowed"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-400 font-bold block mb-1">
                        ลิ้งก์อ้างอิงข้อมูลใหม่
                      </label>
                      <input
                        type="text"
                        value={reportUrls}
                        onChange={(e) => setReportUrls(e.target.value)}
                        className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                        placeholder="เช่น ลิ้งก์ Patreon หรือ Steam"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 font-bold block mb-1">
                        เวอร์ชันที่ควรระบุ
                      </label>
                      <input
                        type="text"
                        value={reportReportedVersion}
                        onChange={(e) => setReportReportedVersion(e.target.value)}
                        className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                        placeholder="ปล่อยว่างหากถูกต้องแล้ว"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-400 font-bold block mb-1">
                        แท็กที่ต้องการแก้ไข
                      </label>
                      <input
                        type="text"
                        value={reportTags}
                        onChange={(e) => setReportTags(e.target.value)}
                        className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                        placeholder="เช่น Comedy, Magic"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 font-bold block mb-1">
                        สถานะความผิดพลาด *
                      </label>
                      <select
                        value={reportErrorStatus}
                        onChange={(e) => setReportErrorStatus(e.target.value)}
                        className="glass-input w-full h-11 px-3 text-sm rounded-xl bg-black text-white cursor-pointer"
                      >
                        <option value="ข้อมูลล้าสมัย" className="bg-black text-white">ข้อมูลล้าสมัย</option>
                        <option value="ลิ้งก์เสีย" className="bg-black text-white">ลิ้งก์เสีย</option>
                        <option value="ข้อมูลไม่ถูกต้อง" className="bg-black text-white">ข้อมูลไม่ถูกต้อง</option>
                        <option value="อื่นๆ" className="bg-black text-white">อื่นๆ</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-bold block mb-1">
                      รายละเอียดข้อร้องเรียนเพิ่มเติม *
                    </label>
                    <textarea
                      required
                      value={reportDescription}
                      onChange={(e) => setReportDescription(e.target.value)}
                      className="glass-input w-full p-4 text-sm rounded-xl h-24 text-slate-200"
                      placeholder="ระบุข้อผิดพลาด เช่น ลิงก์ Patreon ใช้งานไม่ได้ หรือแท็กนี้ไม่เกี่ยวกับตัวเกม..."
                    />
                  </div>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-slate-900 flex justify-end gap-2.5">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-10 px-5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  📤 ส่งคำร้องข้อร้องเรียน
                </button>
                <button
                  type="button"
                  onClick={() => setIsReportingGame(null)}
                  className="bg-slate-900 hover:bg-slate-855 text-slate-355 border border-slate-855 px-5 h-10 rounded-xl font-bold text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* 6. SUGGEST NEW GAME MODAL (FOR REGULAR USER) */}
      {isSuggestingNew && (
        <div className="modal-overlay" onClick={() => setIsSuggestingNew(false)}>
          <div className="modal-content w-full max-w-xl bg-slate-950/95 border border-slate-855 rounded-3xl p-6 relative shadow-2xl" style={{ overflowX: "hidden" }} onClick={(e) => e.stopPropagation()}>
            
            <button
              onClick={() => setIsSuggestingNew(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-855 w-9 h-9 border border-slate-855 rounded-full flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>

            <h2 className="text-lg font-black text-slate-100 mb-4 flex items-center gap-2">
              ➕ เสนอแนะเพิ่มเกมใหม่เข้าระบบหลัก
            </h2>

            <form onSubmit={handleSaveSuggestion} className="flex flex-col gap-4">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">ชื่อเกมที่เสนอแนะ *</label>
                  <input
                    type="text"
                    required
                    value={suggestTitle}
                    onChange={(e) => setSuggestTitle(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="กรอกชื่อภาษาอังกฤษอย่างเป็นทางการ"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">ผู้พัฒนา *</label>
                  <input
                    type="text"
                    required
                    value={suggestDeveloper}
                    onChange={(e) => setSuggestDeveloper(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="เช่น Caribdis"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">เวอร์ชันล่าสุดที่มี *</label>
                  <input
                    type="text"
                    required
                    value={suggestVersion}
                    onChange={(e) => setSuggestVersion(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="เช่น v0.5.1"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">ลิงก์รูปหน้าปกเว็บ/Patreon</label>
                  <input
                    type="text"
                    value={suggestCoverUrl}
                    onChange={(e) => setSuggestCoverUrl(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="https://..."
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">แท็กประเภทแนวเกม (คั่นด้วยจุลภาค)</label>
                <input
                  type="text"
                  value={suggestTags}
                  onChange={(e) => setSuggestTags(e.target.value)}
                  className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                  placeholder="เช่น Comedy, Sci-Fi"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">รายละเอียดเรื่องย่อแบบย่อ</label>
                <textarea
                  value={suggestOverview}
                  onChange={(e) => setSuggestOverview(e.target.value)}
                  className="glass-input w-full p-4 text-sm rounded-xl h-24 text-slate-200"
                  placeholder="พิมพ์คำอธิบายประกอบเบื้องต้น..."
                />
              </div>

              <div className="mt-4 pt-4 border-t border-slate-900 flex justify-end gap-2.5">
                <button
                  type="submit"
                  disabled={isSendingSuggestion}
                  className={`${isSendingSuggestion ? 'bg-blue-800 text-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'} font-bold h-10 px-5 rounded-xl text-xs transition-colors`}
                >
                  {isSendingSuggestion ? '⏳ กำลังส่งข้อมูล...' : '📤 ส่งข้อเสนอแนะแอดมิน'}
                </button>
                <button
                  type="button"
                  disabled={isSendingSuggestion}
                  onClick={() => setIsSuggestingNew(false)}
                  className="bg-slate-900 hover:bg-slate-855 text-slate-355 border border-slate-355 px-5 h-10 rounded-xl font-bold text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ADD TRANSLATED GAME MODAL (POPUP) */}
      {isAddTranslatedOpen && (
        <div className="modal-overlay fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsAddTranslatedOpen(false)}>
          <div
            className="glass-panel w-full max-w-2xl bg-slate-950 border border-slate-800 rounded-3xl p-6 relative shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsAddTranslatedOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 w-9 h-9 border border-slate-800 rounded-full flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>

            <h2 className="text-lg font-black text-slate-100 mb-4 flex items-center gap-1.5">
              🇹🇭 เพิ่มบทความเกมแปลไทยใหม่
            </h2>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const newGame = {
                  id: 'translated-' + Date.now(),
                  title: formData.get('title') || 'Untitled',
                  cover_url: formData.get('cover_url') || '',
                  version: formData.get('version') || 'v1.0 แปลไทย',
                  description: formData.get('description') || '',
                  download_pc: '',
                  download_mobile: ''
                };

                saveTranslatedGame(newGame).then(() => {
                  setTranslatedGames([newGame, ...translatedGames]);
                  setIsAddTranslatedOpen(false);
                  setToastMessage('เพิ่มบทความเกมแปลไทยสำเร็จ!');
                }).catch(err => {
                  console.error(err);
                  alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message);
                });
              }}
              className="flex flex-col gap-4"
            >
              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">ชื่อเกม (Title) *</label>
                <input
                  name="title"
                  type="text"
                  required
                  className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                  placeholder="เช่น Eternum (แปลไทย)"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">เวอร์ชันงานแปล (Version) *</label>
                  <input
                    name="version"
                    type="text"
                    required
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="เช่น v0.9 แปลไทยครบ 100%"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">ลิงก์รูปภาพปก (Cover Image URL)</label>
                  <input
                    name="cover_url"
                    type="url"
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="เช่น https://..."
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400 font-bold block">เนื้อหาบทความ & วิธีติดตั้ง (Markdown Blog) *</label>
                  <span className="text-[10px] text-slate-500 font-semibold">พิมพ์เนื้อหาและสร้างปุ่มดาวน์โหลด/ลิงก์ยืดหยุ่นได้เอง</span>
                </div>

                {/* Markdown Toolbar Helper */}
                <div className="flex flex-wrap gap-1.5 mb-2 bg-slate-900/40 p-2 rounded-xl border border-slate-900">
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('add-translated-desc', '# ')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 h-7 px-2 rounded-lg cursor-pointer"
                    title="หัวข้อหลัก H1"
                  >
                    H1
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('add-translated-desc', '## ')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 h-7 px-2 rounded-lg cursor-pointer"
                    title="หัวข้อรอง H2"
                  >
                    H2
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('add-translated-desc', '**ตัวหนา**')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 h-7 px-2 rounded-lg cursor-pointer"
                    title="ตัวหนา"
                  >
                    <b>B</b>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('add-translated-desc', '- ')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 h-7 px-2 rounded-lg cursor-pointer"
                    title="รายการสัญลักษณ์"
                  >
                    • รายการ
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('add-translated-desc', '\n[💻 ดาวน์โหลดสำหรับ PC](https://...)')}
                    className="bg-blue-950/60 hover:bg-blue-900/60 border border-blue-500/20 text-[10px] font-extrabold text-blue-400 h-7 px-2.5 rounded-lg cursor-pointer"
                    title="ปุ่มดาวน์โหลด PC"
                  >
                    💻 ปุ่ม PC
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('add-translated-desc', '\n[📱 ดาวน์โหลดสำหรับ Android](https://...)')}
                    className="bg-purple-950/60 hover:bg-purple-900/60 border border-purple-500/20 text-[10px] font-extrabold text-purple-400 h-7 px-2.5 rounded-lg cursor-pointer"
                    title="ปุ่มดาวน์โหลด Android"
                  >
                    📱 ปุ่ม Android
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('add-translated-desc', '\n[💬 กลุ่มพูดคุยผลงานแปล](https://...)')}
                    className="bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/20 text-[10px] font-extrabold text-emerald-400 h-7 px-2.5 rounded-lg cursor-pointer"
                    title="ปุ่มลิงก์กลุ่ม/โซเชียล"
                  >
                    💬 ปุ่มโซเชียล
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('add-translated-desc', '[ลิงก์ทั่วไป](https://...)')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 h-7 px-2 rounded-lg cursor-pointer"
                    title="ลิงก์เชื่อมโยงทั่วไป"
                  >
                    🔗 ลิงก์ทั่วไป
                  </button>
                </div>

                <textarea
                  id="add-translated-desc"
                  name="description"
                  required
                  className="glass-input w-full p-4 text-sm rounded-xl h-48 text-slate-200 leading-relaxed font-mono"
                  placeholder="พิมพ์ข้อความรายละเอียด หรือใช้แถบ Shortcut ด้านบนเพื่อช่วยสร้างหัวข้อและปุ่มดาวน์โหลดอย่างอิสระ..."
                />
              </div>

              <div className="mt-4 pt-4 border-t border-slate-900 flex justify-end gap-2.5">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-10 px-5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  💾 บันทึกบทความ

                </button>
                <button
                  type="button"
                  onClick={() => setIsAddTranslatedOpen(false)}
                  className="bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 px-5 h-10 rounded-xl font-bold text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT TRANSLATED GAME MODAL (POPUP) */}
      {isEditTranslatedOpen && editingTranslatedGame && (
        <div className="modal-overlay fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsEditTranslatedOpen(false)}>
          <div
            className="glass-panel w-full max-w-2xl bg-slate-950 border border-slate-800 rounded-3xl p-6 relative shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsEditTranslatedOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 w-9 h-9 border border-slate-800 rounded-full flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>

            <h2 className="text-lg font-black text-slate-100 mb-4 flex items-center gap-1.5">
              🇹🇭 แก้ไขบทความเกมแปลไทย
            </h2>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const updatedGame = {
                  ...editingTranslatedGame,
                  title: formData.get('title') || 'Untitled',
                  cover_url: formData.get('cover_url') || '',
                  version: formData.get('version') || 'v1.0 แปลไทย',
                  description: formData.get('description') || '',
                  download_pc: '',
                  download_mobile: ''
                };

                saveTranslatedGame(updatedGame).then(() => {
                  const updated = translatedGames.map(g => g.id === editingTranslatedGame.id ? updatedGame : g);
                  setTranslatedGames(updated);
                  setIsEditTranslatedOpen(false);
                  setEditingTranslatedGame(null);
                  setToastMessage('แก้ไขบทความเกมแปลไทยสำเร็จ!');
                }).catch(err => {
                  console.error(err);
                  alert('เกิดข้อผิดพลาดในการแก้ไขข้อมูล: ' + err.message);
                });
              }}
              className="flex flex-col gap-4"
            >
              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">ชื่อเกม (Title) *</label>
                <input
                  name="title"
                  type="text"
                  required
                  defaultValue={editingTranslatedGame.title}
                  className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                  placeholder="เช่น Eternum (แปลไทย)"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">เวอร์ชันงานแปล (Version) *</label>
                  <input
                    name="version"
                    type="text"
                    required
                    defaultValue={editingTranslatedGame.version}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="เช่น v0.9 แปลไทยครบ 100%"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">ลิงก์รูปภาพปก (Cover Image URL)</label>
                  <input
                    name="cover_url"
                    type="url"
                    defaultValue={editingTranslatedGame.cover_url}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="เช่น https://..."
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400 font-bold block">เนื้อหาบทความ & วิธีติดตั้ง (Markdown Blog) *</label>
                  <span className="text-[10px] text-slate-500 font-semibold">พิมพ์เนื้อหาและสร้างปุ่มดาวน์โหลด/ลิงก์ยืดหยุ่นได้เอง</span>
                </div>

                {/* Markdown Toolbar Helper */}
                <div className="flex flex-wrap gap-1.5 mb-2 bg-slate-900/40 p-2 rounded-xl border border-slate-900">
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('edit-translated-desc', '# ')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 h-7 px-2 rounded-lg cursor-pointer"
                    title="หัวข้อหลัก H1"
                  >
                    H1
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('edit-translated-desc', '## ')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 h-7 px-2 rounded-lg cursor-pointer"
                    title="หัวข้อรอง H2"
                  >
                    H2
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('edit-translated-desc', '**ตัวหนา**')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 h-7 px-2 rounded-lg cursor-pointer"
                    title="ตัวหนา"
                  >
                    <b>B</b>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('edit-translated-desc', '- ')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 h-7 px-2 rounded-lg cursor-pointer"
                    title="รายการสัญลักษณ์"
                  >
                    • รายการ
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('edit-translated-desc', '\n[💻 ดาวน์โหลดสำหรับ PC](https://...)')}
                    className="bg-blue-950/60 hover:bg-blue-900/60 border border-blue-500/20 text-[10px] font-extrabold text-blue-400 h-7 px-2.5 rounded-lg cursor-pointer"
                    title="ปุ่มดาวน์โหลด PC"
                  >
                    💻 ปุ่ม PC
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('edit-translated-desc', '\n[📱 ดาวน์โหลดสำหรับ Android](https://...)')}
                    className="bg-purple-950/60 hover:bg-purple-900/60 border border-purple-500/20 text-[10px] font-extrabold text-purple-400 h-7 px-2.5 rounded-lg cursor-pointer"
                    title="ปุ่มดาวน์โหลด Android"
                  >
                    📱 ปุ่ม Android
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('edit-translated-desc', '\n[💬 กลุ่มพูดคุยผลงานแปล](https://...)')}
                    className="bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/20 text-[10px] font-extrabold text-emerald-400 h-7 px-2.5 rounded-lg cursor-pointer"
                    title="ปุ่มลิงก์กลุ่ม/โซเชียล"
                  >
                    💬 ปุ่มโซเชียล
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdownDirect('edit-translated-desc', '[ลิงก์ทั่วไป](https://...)')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 h-7 px-2 rounded-lg cursor-pointer"
                    title="ลิงก์เชื่อมโยงทั่วไป"
                  >
                    🔗 ลิงก์ทั่วไป
                  </button>
                </div>

                <textarea
                  id="edit-translated-desc"
                  name="description"
                  required
                  defaultValue={editingTranslatedGame.description}
                  className="glass-input w-full p-4 text-sm rounded-xl h-48 text-slate-200 leading-relaxed font-mono"
                  placeholder="พิมพ์ข้อความรายละเอียด หรือใช้แถบ Shortcut ด้านบนเพื่อช่วยสร้างหัวข้อและปุ่มดาวน์โหลดอย่างอิสระ..."
                />
              </div>

              <div className="mt-4 pt-4 border-t border-slate-900 flex justify-end gap-2.5">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-10 px-5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  💾 บันทึกการเปลี่ยนแปลง
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditTranslatedOpen(false)}
                  className="bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 px-5 h-10 rounded-xl font-bold text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. ADMIN ADD GAME MODAL (POPUP) */}
      {adminAddGameOpen && (
        <div className="modal-overlay" onClick={() => setAdminAddGameOpen(false)}>
          <div className="modal-content w-full max-w-2xl bg-slate-955/95 border border-slate-855 rounded-3xl p-6 relative shadow-2xl" style={{ overflowX: "hidden" }} onClick={(e) => e.stopPropagation()}>
            
            <button
              onClick={() => setAdminAddGameOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-855 w-9 h-9 border border-slate-855 rounded-full flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>

            <h2 className="text-lg font-black text-slate-100 mb-4">
              ➕ แผงแอดมิน: เพิ่มเกมเข้าระบบใหม่
            </h2>

            <form onSubmit={handleSaveAdminForm} className="flex flex-col gap-4">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">ชื่อเกมหลัก *</label>
                  <input
                    type="text"
                    required
                    value={adminTitle}
                    onChange={(e) => setAdminTitle(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="เช่น Eternum"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">ผู้พัฒนา *</label>
                  <input
                    type="text"
                    required
                    value={adminDeveloper}
                    onChange={(e) => setAdminDeveloper(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="เช่น Caribdis"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">เวอร์ชันเกม *</label>
                  <input
                    type="text"
                    required
                    value={adminVersion}
                    onChange={(e) => setAdminVersion(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="เช่น v0.6.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">แท็กหมวดหมู่ (คั่นด้วยเครื่องหมายจุลภาค)</label>
                  <input
                    type="text"
                    value={adminTags}
                    onChange={(e) => setAdminTags(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                    placeholder="Comedy, Sci-Fi, Drama"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5 max-h-20 overflow-y-auto pr-1">
                    {globalTags.map(tag => {
                      const isActive = adminTags ? adminTags.split(',').map(t => t.trim()).includes(tag) : false;
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            const currentTags = adminTags ? adminTags.split(',').map(t => t.trim()).filter(Boolean) : [];
                            if (currentTags.includes(tag)) {
                              setAdminTags(currentTags.filter(t => t !== tag).join(', '));
                            } else {
                              setAdminTags([...currentTags, tag].join(', '));
                            }
                          }}
                          className={`text-[9px] font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                            isActive
                              ? 'bg-blue-600 text-white border border-blue-500'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                          }`}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">คะแนนตั้งต้นระบบ (1.0 - 5.0)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.0"
                    max="5.0"
                    value={adminRating}
                    onChange={(e) => setAdminRating(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1 font-semibold">อัปโหลดรูปปก (Base64)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      id="admin-cover-upload-add"
                      onChange={handleAdminCoverUpload}
                      className="hidden"
                    />
                    <label
                      htmlFor="admin-cover-upload-add"
                      className="bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl cursor-pointer border border-slate-800 transition-colors shrink-0"
                    >
                      📤 อัปโหลดปก
                    </label>
                    <input
                      type="text"
                      value={adminCoverUrl}
                      onChange={(e) => setAdminCoverUrl(e.target.value)}
                      className="glass-input flex-grow h-11 px-4 text-xs rounded-xl text-slate-200"
                      placeholder="หรือพิมพ์ URL รูปภาพตรงนี้..."
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">รายละเอียดเนื้อหาเรื่องย่อเกมหลัก</label>
                <textarea
                  value={adminOverview}
                  onChange={(e) => setAdminOverview(e.target.value)}
                  className="glass-input w-full p-4 text-sm rounded-xl h-24 text-slate-200"
                  placeholder="เขียนเรื่องย่ออย่างเป็นทางการ..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold block mb-1">Patreon URL</label>
                  <input
                    type="text"
                    value={adminPatreonUrl}
                    onChange={(e) => setAdminPatreonUrl(e.target.value)}
                    className="glass-input w-full h-9 px-3 text-[11px] rounded-lg text-slate-200"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold block mb-1">Steam/Buy URL</label>
                  <input
                    type="text"
                    value={adminBuyUrl}
                    onChange={(e) => setAdminBuyUrl(e.target.value)}
                    className="glass-input w-full h-9 px-3 text-[11px] rounded-lg text-slate-200"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold block mb-1">Social/Twitter URL</label>
                  <input
                    type="text"
                    value={adminSocialUrl}
                    onChange={(e) => setAdminSocialUrl(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">
                  อัปโหลดภาพตัวอย่างหลัก (สูงสุด 4 รูป)
                </label>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      id="screenshot-upload-admin-add"
                      multiple
                      onChange={handleAdminScreenshotUpload}
                      className="hidden"
                      disabled={adminScreenshots.length >= 4}
                    />
                    <label
                      htmlFor="screenshot-upload-admin-add"
                      className={`text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer border transition-colors shrink-0 ${
                        adminScreenshots.length >= 4
                          ? 'bg-slate-900 text-slate-650 border-slate-900 cursor-not-allowed'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-800'
                      }`}
                    >
                      📷 เลือกรูปภาพหน้าจอ
                    </label>
                    <span className="text-[10px] text-slate-500">({adminScreenshots.length}/4 รูป)</span>
                  </div>
                  {adminScreenshots.length > 0 && (
                    <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
                      {adminScreenshots.map((src, idx) => (
                        <div key={idx} className="relative w-16 h-12 rounded-lg overflow-hidden border border-slate-900 shrink-0">
                          <img src={src} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setAdminScreenshots((prev) => prev.filter((_, i) => i !== idx))}
                            className="absolute top-0 right-0 bg-red-650 hover:bg-red-750 text-white w-4 h-4 flex items-center justify-center rounded-bl-lg cursor-pointer text-[10px]"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-900 flex justify-end gap-2.5">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-10 px-5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  💾 บันทึกเกมใหม่
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdminAddGameOpen(false);
                    handleResetAdminForm();
                  }}
                  className="bg-slate-900 hover:bg-slate-855 text-slate-355 border border-slate-855 px-5 h-10 rounded-xl font-bold text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* 8. ADMIN EDIT GAME MODAL (POPUP) */}
      {adminEditGameOpen && (
        <div className="modal-overlay" onClick={() => setAdminEditGameOpen(false)}>
          <div className="modal-content w-full max-w-2xl bg-slate-955/95 border border-slate-855 rounded-3xl p-6 relative shadow-2xl" style={{ overflowX: "hidden" }} onClick={(e) => e.stopPropagation()}>
            
            <button
              onClick={() => setAdminEditGameOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-855 w-9 h-9 border border-slate-855 rounded-full flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>

            <h2 className="text-lg font-black text-slate-100 mb-4">
              ✏️ แผงแอดมิน: แก้ไขข้อมูลเกมหลัก (ID: {adminFormGameId})
            </h2>

            <form onSubmit={handleSaveAdminForm} className="flex flex-col gap-4">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">ชื่อเกมหลัก *</label>
                  <input
                    type="text"
                    required
                    value={adminTitle}
                    onChange={(e) => setAdminTitle(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">ผู้พัฒนา *</label>
                  <input
                    type="text"
                    required
                    value={adminDeveloper}
                    onChange={(e) => setAdminDeveloper(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">เวอร์ชันเกม *</label>
                  <input
                    type="text"
                    required
                    value={adminVersion}
                    onChange={(e) => setAdminVersion(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">แท็กหมวดหมู่ (คั่นด้วยเครื่องหมายจุลภาค)</label>
                  <input
                    type="text"
                    value={adminTags}
                    onChange={(e) => setAdminTags(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5 max-h-20 overflow-y-auto pr-1">
                    {globalTags.map(tag => {
                      const isActive = adminTags ? adminTags.split(',').map(t => t.trim()).includes(tag) : false;
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            const currentTags = adminTags ? adminTags.split(',').map(t => t.trim()).filter(Boolean) : [];
                            if (currentTags.includes(tag)) {
                              setAdminTags(currentTags.filter(t => t !== tag).join(', '));
                            } else {
                              setAdminTags([...currentTags, tag].join(', '));
                            }
                          }}
                          className={`text-[9px] font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                            isActive
                              ? 'bg-blue-600 text-white border border-blue-500'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                          }`}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1">คะแนนจากระบบ (1.0 - 5.0)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.0"
                    max="5.0"
                    value={adminRating}
                    onChange={(e) => setAdminRating(e.target.value)}
                    className="glass-input w-full h-11 px-4 text-sm rounded-xl text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold block mb-1 font-semibold">อัปโหลดรูปปกใหม่ (Base64)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      id="admin-cover-upload-edit"
                      onChange={handleAdminCoverUpload}
                      className="hidden"
                    />
                    <label
                      htmlFor="admin-cover-upload-edit"
                      className="bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl cursor-pointer border border-slate-800 transition-colors shrink-0"
                    >
                      📤 อัปโหลดปก
                    </label>
                    <input
                      type="text"
                      value={adminCoverUrl}
                      onChange={(e) => setAdminCoverUrl(e.target.value)}
                      className="glass-input flex-grow h-11 px-4 text-xs rounded-xl text-slate-200"
                      placeholder="หรือพิมพ์ URL รูปภาพตรงนี้..."
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">รายละเอียดเนื้อหาเรื่องย่อเกมหลัก</label>
                <textarea
                  value={adminOverview}
                  onChange={(e) => setAdminOverview(e.target.value)}
                  className="glass-input w-full p-4 text-sm rounded-xl h-24 text-slate-200"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold block mb-1">Patreon URL</label>
                  <input
                    type="text"
                    value={adminPatreonUrl}
                    onChange={(e) => setAdminPatreonUrl(e.target.value)}
                    className="glass-input w-full h-9 px-3 text-[11px] rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold block mb-1">Steam/Buy URL</label>
                  <input
                    type="text"
                    value={adminBuyUrl}
                    onChange={(e) => setAdminBuyUrl(e.target.value)}
                    className="glass-input w-full h-9 px-3 text-[11px] rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold block mb-1">Social/Twitter URL</label>
                  <input
                    type="text"
                    value={adminSocialUrl}
                    onChange={(e) => setAdminSocialUrl(e.target.value)}
                  />
                </div>
              </div>



              <div>
                <label className="text-xs text-slate-400 font-bold block mb-1">
                  อัปโหลดภาพตัวอย่างหลัก (สูงสุด 4 รูป)
                </label>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      id="screenshot-upload-admin-edit"
                      multiple
                      onChange={handleAdminScreenshotUpload}
                      className="hidden"
                      disabled={adminScreenshots.length >= 4}
                    />
                    <label
                      htmlFor="screenshot-upload-admin-edit"
                      className={`text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer border transition-colors shrink-0 ${
                        adminScreenshots.length >= 4
                          ? 'bg-slate-900 text-slate-650 border-slate-900 cursor-not-allowed'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-800'
                      }`}
                    >
                      📷 เลือกรูปภาพหน้าจอ
                    </label>
                    <span className="text-[10px] text-slate-500">({adminScreenshots.length}/4 รูป)</span>
                  </div>
                  {adminScreenshots.length > 0 && (
                    <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
                      {adminScreenshots.map((src, idx) => (
                        <div key={idx} className="relative w-16 h-12 rounded-lg overflow-hidden border border-slate-900 shrink-0">
                          <img src={src} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setAdminScreenshots((prev) => prev.filter((_, i) => i !== idx))}
                            className="absolute top-0 right-0 bg-red-650 hover:bg-red-750 text-white w-4 h-4 flex items-center justify-center rounded-bl-lg cursor-pointer text-[10px]"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-900 flex justify-end gap-2.5">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-10 px-5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  💾 บันทึกการแก้ไข
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdminEditGameOpen(false);
                    handleResetAdminForm();
                  }}
                  className="bg-slate-900 hover:bg-slate-855 text-slate-355 border border-slate-855 px-5 h-10 rounded-xl font-bold text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* CUSTOM AUTHENTICATION MODAL */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div 
            className="w-full max-w-md bg-slate-900 text-slate-100 rounded-3xl overflow-hidden shadow-2xl border border-slate-800 animate-scale-in relative p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button top right */}
            <button
              onClick={() => {
                setIsAuthModalOpen(false);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-850 hover:bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer text-xs"
              title="ปิด"
            >
              ✕
            </button>

            {/* Header */}
            <div className="flex flex-col items-center text-center pb-2 border-b border-slate-850">
              <span className="text-3xl mb-1">
                🔑
              </span>
              <h2 className="text-lg font-extrabold text-slate-100">
                เข้าสู่ระบบ / สมัครสมาชิก
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                กรุณาเข้าสู่ระบบด้วย Google เพื่อเปิดใช้งานคลังเกมส่วนตัวและร่วมโหวต
              </p>
            </div>

            {/* DB Configuration for Offline Sandbox */}
            {!isFirebaseEnabled && (
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex flex-col gap-2">
                <h4 className="text-xs font-black text-amber-400 flex items-center gap-1.5 text-left">
                  ⚠️ ระบบฐานข้อมูลจำลอง (ยังไม่ได้เชื่อมต่อ Supabase)
                </h4>
                <p className="text-[10px] text-slate-400 leading-normal text-left">
                  กรุณาระบุ URL ของ Supabase Project ด้านล่างนี้เพื่อเชื่อมต่อฐานข้อมูลออนไลน์จริง:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={googleSheetsUrl}
                    onChange={(e) => setGoogleSheetsUrlState(e.target.value)}
                    className="flex-1 h-9 px-3 text-[11px] rounded-xl border border-slate-800 bg-slate-955 text-slate-200 focus:outline-none focus:border-blue-500"
                    placeholder="https://your-project.supabase.co"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!googleSheetsUrl) {
                        alert('กรุณากรอก Supabase URL ก่อนกดเชื่อมต่อ');
                        return;
                      }
                      const key = prompt('กรุณากรอก Supabase Anon Key ของโปรเจกต์:');
                      if (!key) {
                        alert('จำเป็นต้องกรอก Anon Key เพื่อใช้เชื่อมต่อ');
                        return;
                      }
                      setApiUrl(googleSheetsUrl, key);
                      window.location.reload();
                    }}
                    className="bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-black px-3 rounded-xl cursor-pointer transition-colors"
                  >
                    เชื่อมต่อ
                  </button>
                </div>
              </div>
            )}

            {/* Form */}
            {isLoggingIn ? (
              <div className="py-12 flex flex-col items-center justify-center gap-4">
                <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm font-semibold text-slate-400">กำลังดำเนินการ...</span>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={async () => {
                    setIsLoggingIn(true);
                    try {
                      await loginWithGoogle();
                    } catch (err) {
                      alert('Login with Google failed: ' + err.message);
                      setIsLoggingIn(false);
                    }
                  }}
                  disabled={!isFirebaseEnabled}
                  className={`w-full h-12 bg-white hover:bg-gray-100 text-gray-800 font-extrabold text-sm rounded-xl transition-all shadow-md focus:outline-none flex items-center justify-center gap-3 ${!isFirebaseEnabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                    <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
                      <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z"/>
                      <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.369 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z"/>
                      <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.724 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z"/>
                      <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.109 -17.884 43.989 -14.754 43.989 Z"/>
                    </g>
                  </svg>
                  Login with Google
                </button>





              </div>
            )}
          </div>
        </div>
      )}

      {/* PREMIUM UPSELL MODAL */}
      {isUpsellOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div 
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 pb-4 border-b border-slate-850 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-100 flex items-center gap-2">
                👑 อัปเกรดสถานะพรีเมียม (Premium Member)
              </h3>
              <button
                onClick={() => {
                  setIsUpsellOpen(false);
                  setSelectedSlipFile(null);
                  setSelectedSlipFilePreview(null);
                }}
                className="text-slate-455 hover:text-white bg-slate-955 hover:bg-slate-855 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer text-xs"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="p-5 flex flex-col gap-4 text-center max-h-[80vh] overflow-y-auto">
              <div>
                <h4 className="text-base font-black text-amber-400">เข้าถึงสิทธิประโยชน์ระดับพรีเมียม</h4>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed max-w-sm mx-auto">
                  ขยายขีดความสามารถการบันทึกประวัติการเล่น พร้อมเปิดระบบแจ้งเตือนเกมอัปเดตเวอร์ชันใหม่ด่วนพิเศษ
                </p>
              </div>

              {/* Benefits list */}
              <div className="text-left bg-slate-950/60 border border-slate-900 rounded-2xl p-4 flex flex-col gap-2.5">
                <span className="text-xs font-bold text-amber-400 block mb-1">✨ สิ่งที่คุณจะได้รับเมื่อสมัคร Premium:</span>
                <ul className="text-[11px] text-slate-300 flex flex-col gap-2 leading-relaxed">
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold">1.</span>
                    <span>สามารถบันทึกสถานะของเกมได้ไม่จำกัด (จากปกติฟรีได้แค่ 5 เกม)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold">2.</span>
                    <span>ระบบแจ้งเตือนเกมผ่านกระดิ่งเมื่อมีเวอร์ชันใหม่ออกมาให้เล่น</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold">3.</span>
                    <span>ร่วมสนับสนุนการพัฒนาฟีเจอร์ใหม่ๆ เพื่อประสบการณ์ผู้ใช้ที่ดียิ่งขึ้น</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold">4.</span>
                    <span>ช่วยสนับสนุนค่ารันเซิร์ฟเวอร์หลักของระบบให้ยังคงเปิดอยู่ได้</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold">5.</span>
                    <span>เป็นค่ากาแฟและกำลังใจเล็กๆ น้อยๆ ให้แอดมินผู้พัฒนา</span>
                  </li>
                </ul>
              </div>

              {/* Price Selector */}
              <div className="mt-1">
                <div 
                  className="p-3.5 rounded-2xl flex flex-col items-center justify-center relative transition-all border bg-slate-955 border-amber-500 shadow-md shadow-amber-500/5"
                >
                  <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">แพ็กเกจ Premium</span>
                  <span className="text-lg font-black text-slate-100 mt-1 flex items-baseline gap-1">
                    รายเดือน 49 บาท
                    <span className="text-[10px] text-slate-400 font-normal font-sans">/เดือน</span>
                  </span>
                </div>
              </div>



              <div className="my-2 p-3 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-center flex flex-col items-center gap-1.5">
                <span className="text-[11px] font-black text-amber-300">
                  โอนเงินแล้วส่งสลิปมาใน Facebook Page:
                </span>
                <a 
                  href="https://web.facebook.com/deenizegames?locale=th_TH" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs font-black text-amber-400 hover:text-amber-300 underline transition-all flex items-center gap-1"
                >
                  DeeNize Games 🔗
                </a>
              </div>

              {/* Real PromptPay QR Code Image */}
              <div className="my-2 flex flex-col items-center">
                <div className="w-[185px] h-[245px] border border-slate-700 rounded-2xl overflow-hidden shadow-2xl p-2 bg-slate-900 flex flex-col items-center justify-center">
                  <img 
                    src="/payment_qr.jpg" 
                    alt="PromptPay QR Code" 
                    className="w-full h-full object-cover rounded-xl"
                  />
                </div>
                <span className="text-[10px] font-black text-amber-400 mt-2 bg-slate-950/80 px-3 py-1 rounded-full border border-slate-800">
                  Scan to Pay • DeeNize Games • ยอดโอน {selectedPackage === 'monthly' ? '49' : '499'} บาท
                </span>
              </div>

              {/* SlipOK Scan Console & Image Preview */}
              {isSlipChecking && (
                <div className="flex flex-col gap-3.5 bg-slate-950/80 border border-slate-900 rounded-2xl p-4.5 text-left">
                  <div className="flex items-center gap-3">
                    {uploadedSlipPreview && (
                      <div className="w-11 h-14 rounded-lg overflow-hidden border border-slate-800 shrink-0 bg-slate-900">
                        <img src={uploadedSlipPreview} alt="Slip Uploaded" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="flex-grow">
                      <span className="text-[10px] text-slate-500 font-extrabold uppercase block">สถานะการทำรายการ</span>
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-300 mt-1">
                        <div className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                        <span>SlipOK กำลังประมวลผลธุรกรรม...</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Console Logs */}
                  <div className="bg-black border border-slate-900 rounded-xl p-3 h-28 overflow-y-auto font-mono text-[9px] text-emerald-400 flex flex-col gap-1 select-none scrollbar-thin">
                    {slipCheckLogs.map((log, idx) => (
                      <div key={idx} className="leading-normal">{log}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col gap-2">
                {!isSlipChecking && (
                  <button
                    type="button"
                    onClick={handleSubmitApprovalRequest}
                    className="w-full h-11 flex items-center justify-center gap-2 text-white text-xs font-black rounded-xl transition-all shadow-lg bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 shadow-amber-500/15 cursor-pointer"
                  >
                    📤 ส่งให้แอดมินอนุมัติ
                  </button>
                )}
                
                <button
                  type="button"
                  disabled={isSlipChecking}
                  onClick={() => {
                    setIsUpsellOpen(false);
                    setSelectedSlipFile(null);
                    setSelectedSlipFilePreview(null);
                  }}
                  className={`text-xs font-bold text-slate-500 hover:text-slate-350 py-1 transition-colors ${
                    isSlipChecking ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                  }`}
                >
                  ไว้ทีหลัง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM SYSTEM ALERT MODAL */}
      {customAlert && (
        <div className="fixed inset-0 bg-slate-955/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div 
            className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 pb-3.5 border-b border-slate-850 flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-100 flex items-center gap-2">
                {customAlert.title}
              </h3>
              <button
                onClick={() => setCustomAlert(null)}
                className="text-slate-455 hover:text-white bg-slate-955 hover:bg-slate-855 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer text-xs"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="p-5 flex flex-col gap-4 text-center">
              <p className="text-xs text-slate-200 leading-relaxed font-bold">
                {customAlert.message}
              </p>
              <button
                type="button"
                onClick={() => setCustomAlert(null)}
                className="w-full h-10 flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl cursor-pointer transition-all shadow-md"
              >
                ตกลง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM SYSTEM CONFIRM MODAL */}
      {customConfirm && (
        <div className="fixed inset-0 bg-slate-955/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div 
            className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 pb-3.5 border-b border-slate-850 flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-100 flex items-center gap-2">
                {customConfirm.title || 'ยืนยันการทำรายการ'}
              </h3>
              <button
                onClick={() => setCustomConfirm(null)}
                className="text-slate-455 hover:text-white bg-slate-955 hover:bg-slate-855 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer text-xs"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="p-5 flex flex-col gap-4 text-center">
              <p className="text-xs text-slate-200 leading-relaxed font-bold whitespace-pre-line">
                {customConfirm.message}
              </p>
              <div className="flex gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (customConfirm.onConfirm) {
                      customConfirm.onConfirm();
                    }
                    setCustomConfirm(null);
                  }}
                  className="flex-1 h-10 flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl cursor-pointer transition-all shadow-md"
                >
                  ตกลง
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (customConfirm.onCancel) {
                      customConfirm.onCancel();
                    }
                    setCustomConfirm(null);
                  }}
                  className="flex-1 h-10 flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-200 text-xs font-bold rounded-xl cursor-pointer transition-colors"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOAST SYSTEM POPUP */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-slate-900 border border-blue-500 text-blue-400 font-bold px-5 py-3 rounded-xl shadow-2xl z-[9999] flex items-center gap-2 animate-fade-in-up">
          <span className="text-lg">💡</span> {toastMessage}
        </div>
      )}

      {/* VIEW SLIP MODAL FOR ADMIN */}
      {selectedAdminTxSlip && (
        <div className="fixed inset-0 bg-slate-955/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div 
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 pb-4 border-b border-slate-850 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-100 flex items-center gap-2">
                🔎 ตรวจสอบสลิปและสถานะการโอน
              </h3>
              <button
                onClick={() => setSelectedAdminTxSlip(null)}
                className="text-slate-455 hover:text-white bg-slate-955 hover:bg-slate-855 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer text-xs"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="p-5 flex flex-col gap-4 text-center max-h-[80vh] overflow-y-auto">
              {/* Slip Image/Mockup container */}
              <div className="flex justify-center bg-slate-950/40 p-3 rounded-2xl border border-slate-800">
                {selectedAdminTxSlip.slipUrl && (selectedAdminTxSlip.slipUrl.startsWith('http') || selectedAdminTxSlip.slipUrl.startsWith('data:')) && !slipImageLoadError ? (
                  <div className="w-full max-w-[280px] rounded-2xl overflow-hidden border border-slate-700 shadow-md flex flex-col gap-2 p-1 bg-slate-900">
                    <img 
                      src={selectedAdminTxSlip.slipUrl} 
                      alt="Payment Slip" 
                      className="w-full h-auto object-contain max-h-[320px] mx-auto rounded-xl"
                      onError={() => {
                        setSlipImageLoadError(true);
                      }}
                    />
                    <a 
                      href={selectedAdminTxSlip.slipUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-[10px] text-blue-400 hover:text-blue-300 font-bold underline py-1 block text-center"
                    >
                      🔗 เปิดดูรูปภาพสลิปในหน้าต่างใหม่
                    </a>
                  </div>
                ) : (
                  <div className="w-full max-w-[260px] bg-white text-slate-800 rounded-2xl p-5 text-left font-sans shadow-md border border-slate-200 relative select-none">
                    {/* Bank branding */}
                    <div className="flex items-center justify-between border-b border-dashed border-slate-300 pb-3 mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-white font-extrabold text-[9px] font-sans">
                          KB
                        </div>
                        <div>
                          <span className="text-[10px] font-black block text-slate-900 leading-none font-sans">ธนาคารกสิกรไทย</span>
                          <span className="text-[7px] text-slate-500 block font-sans">KASIKORNBANK</span>
                        </div>
                      </div>
                      <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-black font-sans">โอนเงินสำเร็จ</span>
                    </div>

                    {/* Receipt fields */}
                    <div className="flex flex-col gap-2 text-[9px] font-sans">
                      <div>
                        <span className="text-slate-400 block text-[7px] font-sans">รหัสอ้างอิง (Ref ID)</span>
                        <span className="font-mono font-bold text-slate-800 block text-[9.5px] break-all">{selectedAdminTxSlip.transRef || 'N/A'}</span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 font-sans">
                        <div>
                          <span className="text-slate-400 block text-[7px] font-sans">ผู้โอน</span>
                          <span className="font-bold text-slate-800 block truncate font-sans">{selectedAdminTxSlip.username}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[7px] font-sans">ผู้รับโอน</span>
                          <span className="font-bold text-slate-800 block font-sans">AVN Star Hub</span>
                        </div>
                      </div>

                      <div className="border-t border-slate-100 pt-2 font-sans">
                        <span className="text-slate-400 block text-[7px] font-sans">บัญชีผู้สมัคร</span>
                        <span className="font-semibold text-slate-700 block truncate font-sans">{selectedAdminTxSlip.email}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 font-sans">
                        <div>
                          <span className="text-slate-400 block text-[7px] font-sans">แพ็กเกจ</span>
                          <span className="font-bold text-slate-800 block font-sans">{selectedAdminTxSlip.package === 'yearly' ? 'รายปี (Premium)' : 'รายเดือน (Premium)'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[7px] font-sans">จำนวนเงิน</span>
                          <span className="font-black text-slate-900 block text-[10.5px] font-sans">{selectedAdminTxSlip.amount} บาท</span>
                        </div>
                      </div>

                      <div className="border-t border-slate-100 pt-2 font-sans">
                        <span className="text-slate-400 block text-[7px] font-sans">วันเวลาทำรายการ</span>
                        <span className="text-slate-650 block font-sans">{formatThaiDate(selectedAdminTxSlip.timestamp)}</span>
                      </div>
                    </div>

                    {/* QR Code Simulation */}
                    <div className="flex justify-center mt-3 pt-2.5 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 border border-slate-200 relative flex flex-wrap p-0.5 bg-white shrink-0">
                          <div className="w-2.5 h-2.5 bg-slate-900"></div>
                          <div className="w-2.5 h-2.5 bg-white flex-1"></div>
                          <div className="w-2.5 h-2.5 bg-slate-900"></div>
                          <div className="w-2.5 h-2.5 bg-white"></div>
                          <div className="w-2.5 h-2.5 bg-slate-900"></div>
                          <div className="w-2.5 h-2.5 bg-white"></div>
                          <div className="w-2.5 h-2.5 bg-slate-900"></div>
                          <div className="w-2.5 h-2.5 bg-white"></div>
                          <div className="w-2.5 h-2.5 bg-slate-900"></div>
                        </div>
                        <div className="text-[7.5px] leading-tight text-slate-400 max-w-[150px] font-sans">
                          <span className="font-bold text-slate-600 block font-sans">สลิปตรวจสอบแล้ว (Method 1)</span>
                          ข้อมูลสลิปสแกนและบันทึกข้อความสำเร็จ (ภาพสลิปถูกลบทิ้งแล้ว)
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Status Warning Details */}
              <div className="text-left bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2">
                <span className="text-xs font-bold text-slate-200 block">📋 รายละเอียดการตรวจสอบเชิงระบบ:</span>
                
                {selectedAdminTxSlip.status === 'pending' ? (
                  <div className="text-[11px] text-amber-400 flex flex-col gap-1.5 leading-relaxed bg-amber-500/5 border border-amber-500/10 p-2.5 rounded-xl">
                    <span className="font-black flex items-center gap-1">⚠️ ตรวจพบลักษณะสลิปต้องสงสัย (Pending)</span>
                    <span className="text-[10px] text-slate-300">
                      - ตรวจพบค่าความคล้ายคลึงของเลขรหัสอ้างอิง (Ref) หรือยอดเงินไม่สอดคล้องกับฐานข้อมูลปัจจุบัน
                    </span>
                    <span className="text-[10px] text-slate-300">
                      - ข้อแนะนำสำหรับแอดมิน: กรุณาเปิดแอปพลิเคชันบัญชีธนาคารเพื่อตรวจสอบยอดเงินรับเข้าปลายทางจริง หากมีเงินเข้าถูกต้องจำนวน {selectedAdminTxSlip.amount} บาท ให้กดปุ่มอนุมัติระบบด้านล่าง
                    </span>
                  </div>
                ) : selectedAdminTxSlip.status === 'success' ? (
                  <div className="text-[11px] text-emerald-400 flex flex-col gap-1 leading-relaxed bg-emerald-500/5 border border-emerald-500/10 p-2.5 rounded-xl">
                    <span className="font-black">🟢 ตรวจสอบถูกต้องสำเร็จ (Success)</span>
                    <span className="text-[10px] text-slate-350">
                      - ผ่านการยืนยันข้อมูลแล้ว และผู้สมัครได้รับสิทธิ์ Premium เรียบร้อย
                    </span>
                  </div>
                ) : (
                  <div className="text-[11px] text-red-400 flex flex-col gap-1.5 leading-relaxed bg-rose-500/5 border border-rose-500/10 p-2.5 rounded-xl">
                    <span className="font-black flex items-center gap-1">🔴 รายการชำระเงินไม่ถูกต้อง (Failed)</span>
                    <span className="text-[10px] text-slate-350">
                      - เหตุผลการปฏิเสธ: {selectedAdminTxSlip.reason || 'ตรวจสอบพบลักษณะสลิปซ้ำซ้อนหรือยอดโอนไม่ตรง'}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons inside inspect modal */}
              {selectedAdminTxSlip.status === 'pending' && (
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      handleAdminApproveTx(selectedAdminTxSlip);
                      setSelectedAdminTxSlip(null);
                    }}
                    className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl cursor-pointer transition-all shadow-lg"
                  >
                    ✔️ อนุมัติสิทธิ์
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleAdminRejectTx(selectedAdminTxSlip);
                      setSelectedAdminTxSlip(null);
                    }}
                    className="w-full h-11 bg-red-650 hover:bg-red-550 text-white text-xs font-black rounded-xl cursor-pointer transition-all shadow-lg"
                  >
                    ❌ ปฏิเสธรายการ
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setSelectedAdminTxSlip(null)}
                className="w-full h-10 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-slate-300 text-xs font-bold rounded-xl cursor-pointer transition-colors"
              >
                ปิดหน้าต่างตรวจสอบ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. TRANSLATION VOTING POPUP MODAL */}
      {isVotingModalOpen && (
        <div className="modal-overlay animate-fade-in" onClick={() => setIsVotingModalOpen(false)}>
          <div className="modal-content w-full max-w-2xl bg-slate-955/95 border border-slate-850 rounded-3xl p-6 relative shadow-2xl" onClick={(e) => e.stopPropagation()}>
            
            <button
              onClick={() => setIsVotingModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-855 w-9 h-9 border border-slate-800 rounded-full flex items-center justify-center cursor-pointer transition-colors"
            >
              ✕
            </button>

            <div className="flex flex-col gap-4.5">
              <div>
                <h2 className="text-lg font-black text-slate-100 flex items-center gap-2">
                  🗳️ ร่วมโหวตโปรเจกต์แปลไทยเกมถัดไป
                </h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  โหวตเกมที่คุณอยากให้เราทำการแปลภาษาไทยในโปรเจกต์ถัดไป! (คะแนนเสียงของผู้ใช้ Premium จะได้รับการพิจารณาเป็นพิเศษ)
                </p>
              </div>

              {/* Leaderboard Cards Section */}
              <div className="flex flex-col gap-3.5 max-h-[360px] overflow-y-auto pr-1.5 scrollbar-thin">
                {votingLeaderboard.length === 0 ? (
                  <div className="text-center py-8 bg-slate-900/25 border border-dashed border-slate-800 rounded-2xl">
                    <span className="text-slate-500 text-xs block">ยังไม่มีผู้ท้าชิงเปิดให้โหวตในขณะนี้</span>
                  </div>
                ) : (
                  votingLeaderboard.map((candidate, idx) => {
                    const userVote = translationVotes.find(v => v.user_id === currentUser && v.candidate_id === candidate.id);
                    const hasVotedThis = !!userVote;

                    // Calculate progress percentages (max total in leaderboard)
                    const maxVotes = Math.max(...votingLeaderboard.map(c => c.total), 1);
                    const premiumPct = (candidate.premiumCount / maxVotes) * 100;
                    const normalPct = (candidate.normalCount / maxVotes) * 100;

                    const handleVote = async () => {
                      if (isGuest) {
                        setIsAuthModalOpen(true);
                        setIsVotingModalOpen(false);
                        setToastMessage('🔑 กรุณาเข้าสู่ระบบก่อนลงคะแนนโหวตครับ');
                        return;
                      }
                      
                      try {
                        const isPremiumUser = subscriptionRole === 'premium';
                        await submitTranslationVote(currentUser, currentUser, candidate.id, isPremiumUser);
                        
                        // Optimistically update votes list
                        const newVote = {
                          user_id: currentUser,
                          email: currentUser,
                          candidate_id: candidate.id,
                          is_premium: isPremiumUser,
                          created_at: new Date().toISOString()
                        };
                        setTranslationVotes(prev => {
                          const filtered = prev.filter(v => v.user_id !== currentUser);
                          return [...filtered, newVote];
                        });
                        setToastMessage(`🗳️ โหวตให้กับเกม "${candidate.title}" สำเร็จ!`);
                      } catch (err) {
                        console.error(err);
                        alert('ไม่สามารถส่งผลโหวตได้: ' + err.message);
                      }
                    };

                    return (
                      <div key={candidate.id} className={`glass-card-minimal p-4 rounded-2xl flex gap-4 items-center border transition-all ${
                        hasVotedThis ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-850'
                      }`}>
                        
                        {/* Candidate Cover (Aspect 3/4) */}
                        <div className="w-12 h-16 shrink-0 rounded-lg overflow-hidden border border-white/5 bg-slate-955 relative">
                          {candidate.coverUrl ? (
                            <img src={candidate.coverUrl} className="w-full h-full object-cover" alt="" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-black text-slate-600 text-xs">
                              {getInitials(candidate.title)}
                            </div>
                          )}
                        </div>

                        {/* Middle info & stats */}
                        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                          <div className="flex justify-between items-center gap-2">
                            <h4 className="text-xs font-extrabold text-slate-100 truncate">
                              #{idx + 1} {candidate.title}
                            </h4>
                            {hasVotedThis && (
                              <span className="text-[9px] font-black text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 uppercase tracking-widest animate-pulse">
                                ✅ โหวตแล้ว
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 line-clamp-1 leading-relaxed">
                            {candidate.description || 'ไม่มีรายละเอียดสำหรับเกมนี้'}
                          </p>

                          {/* Progress stacked bar */}
                          <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
                            {candidate.premiumCount > 0 && (
                              <div 
                                style={{ width: `${premiumPct}%` }} 
                                className="bg-gradient-to-r from-amber-500 to-yellow-600 h-full"
                                title={`Premium: ${candidate.premiumCount} เสียง`}
                              />
                            )}
                            {candidate.normalCount > 0 && (
                              <div 
                                style={{ width: `${normalPct}%` }} 
                                className="bg-gradient-to-r from-blue-500 to-indigo-600 h-full"
                                title={`ทั่วไป: ${candidate.normalCount} เสียง`}
                              />
                            )}
                          </div>

                          <div className="flex items-center justify-between text-[9px] text-slate-500 font-bold">
                            <span className="flex items-center gap-1.5">
                              <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full" />
                              Premium: {candidate.premiumCount}
                              <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1" />
                              ทั่วไป: {candidate.normalCount}
                            </span>
                            <span className="text-slate-400">
                              รวม {candidate.total} เสียง
                            </span>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="shrink-0">
                          {isGuest ? (
                            <button
                              onClick={handleVote}
                              className="bg-slate-900 hover:bg-slate-855 text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-700 text-[10px] font-black h-8 px-3 rounded-lg cursor-pointer transition-all"
                            >
                              🔑 ล็อกอิน
                            </button>
                          ) : (
                            <button
                              onClick={handleVote}
                              disabled={hasVotedThis}
                              className={`text-[10px] font-black h-8 px-3 rounded-lg cursor-pointer transition-all border ${
                                hasVotedThis 
                                  ? 'bg-amber-600/5 border-amber-500/20 text-amber-400 cursor-default'
                                  : 'bg-blue-600 hover:bg-blue-500 border-blue-600 hover:border-blue-500 text-white active:scale-95'
                              }`}
                            >
                              {hasVotedThis ? 'โหวตแล้ว' : 'โหวต'}
                            </button>
                          )}
                        </div>

                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer text */}
              <div className="pt-3 border-t border-slate-900 flex justify-between items-center text-[10px] text-slate-500">
                <span>
                  * ข้อมูลการโหวตทั้งหมดอัปเดตแบบเรียลไทม์ (1 สิทธิ์ต่อ 1 บัญชีผู้ใช้)
                </span>
                <button
                  type="button"
                  onClick={() => setIsVotingModalOpen(false)}
                  className="bg-slate-900 hover:bg-slate-855 text-slate-350 px-4 h-8.5 rounded-xl border border-slate-800 font-bold cursor-pointer transition-colors"
                >
                  ปิดหน้าต่าง
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* ADMIN ADD/EDIT BANNER MODAL */}
      {(isAddBannerOpen || isEditBannerOpen) && (
        <div className="modal-overlay animate-fade-in" onClick={() => { setIsAddBannerOpen(false); setIsEditBannerOpen(false); }}>
          <div className="modal-content w-full max-w-lg bg-slate-955 border border-slate-850 rounded-3xl p-6 relative shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-extrabold text-slate-100 mb-4">
              {isEditBannerOpen ? '✏️ แก้ไขแบนเนอร์ประกาศ' : '➕ สร้างแบนเนอร์ใหม่'}
            </h3>
            
            <div className="flex flex-col gap-3 text-xs">
              <div className="flex flex-col gap-1">
                <label className="text-slate-400 font-bold">ประเภทแบนเนอร์</label>
                <select
                  value={bannerFormType}
                  onChange={(e) => setBannerFormType(e.target.value)}
                  className="glass-input h-9 px-3 rounded-xl text-slate-200"
                >
                  <option value="normal" className="bg-black text-slate-200">📢 ประกาศทั่วไป (พร้อมลิงก์เว็บอื่น)</option>
                  <option value="game_promo" className="bg-black text-slate-200">🔥 โปรโมตเกม (ปักหมุดเกมในระบบ)</option>
                  <option value="voting" className="bg-black text-slate-200">🗳️ กิจกรรมโหวตแปลเกมถัดไป</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-slate-400 font-bold">หัวข้อเด่น (Title)</label>
                <input
                  type="text"
                  value={bannerFormTitle}
                  onChange={(e) => setBannerFormTitle(e.target.value)}
                  className="glass-input h-9 px-3 rounded-xl text-slate-200"
                  placeholder="เช่น ร่วมโหวตแปลไทย, โปรโมชั่นพิเศษ..."
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-slate-400 font-bold">คำอธิบาย/คำโปรย (Subtitle)</label>
                <textarea
                  value={bannerFormSubtitle}
                  onChange={(e) => setBannerFormSubtitle(e.target.value)}
                  className="glass-input p-3 rounded-xl text-slate-200 h-16 resize-none"
                  placeholder="เขียนคำอธิบายสั้นๆ..."
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-slate-400 font-bold">ลิงก์รูปภาพประกอบ (Cover Image URL - ตัวเลือก)</label>
                <input
                  type="text"
                  value={bannerFormCoverUrl}
                  onChange={(e) => setBannerFormCoverUrl(e.target.value)}
                  className="glass-input h-9 px-3 rounded-xl text-slate-200"
                  placeholder="https://..."
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-slate-400 font-bold">CSS Background Gradient</label>
                <input
                  type="text"
                  value={bannerFormBgGradient}
                  onChange={(e) => setBannerFormBgGradient(e.target.value)}
                  className="glass-input h-9 px-3 rounded-xl text-slate-200 font-mono"
                  placeholder="from-blue-955/70 to-indigo-950/70"
                />
              </div>

              {bannerFormType === 'normal' && (
                <div className="flex flex-col gap-1 animate-fade-in">
                  <label className="text-slate-400 font-bold">ลิงก์ปลายทางเมื่อคลิก (Link URL - ปล่อยว่างถ้าคลิกไม่ได้)</label>
                  <input
                    type="text"
                    value={bannerFormLinkUrl}
                    onChange={(e) => setBannerFormLinkUrl(e.target.value)}
                    className="glass-input h-9 px-3 rounded-xl text-slate-200"
                    placeholder="https://..."
                  />
                </div>
              )}

              {bannerFormType === 'game_promo' && (
                <div className="flex flex-col gap-1 animate-fade-in">
                  <label className="text-slate-400 font-bold">เลือกเกมในระบบเพื่อปักหมุด (ปล่อยว่างเพื่อสุ่มเกมอัตโนมัติ)</label>
                  <select
                    value={bannerFormTargetGameId}
                    onChange={(e) => setBannerFormTargetGameId(e.target.value)}
                    className="glass-input h-9 px-3 rounded-xl text-slate-200"
                  >
                    <option value="" className="bg-black text-slate-400">🎲 สุ่มเกมในระบบอัตโนมัติ</option>
                    {officialGames.map(g => (
                      <option key={g.id} value={g.id} className="bg-black text-slate-200">
                        {g.title} (โดย {g.developer})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-6 mt-1">
                <label className="flex items-center gap-2 text-slate-350 cursor-pointer font-bold">
                  <input
                    type="checkbox"
                    checked={bannerFormIsActive}
                    onChange={(e) => setBannerFormIsActive(e.target.checked)}
                    className="w-4 h-4 cursor-pointer"
                  />
                  เปิดใช้งานแบนเนอร์นี้
                </label>

                <div className="flex items-center gap-2">
                  <label className="text-slate-400 font-bold shrink-0">ลำดับการแสดงผล:</label>
                  <input
                    type="number"
                    value={bannerFormSortOrder}
                    onChange={(e) => setBannerFormSortOrder(parseInt(e.target.value) || 0)}
                    className="glass-input w-16 h-8 text-center rounded-lg text-slate-200"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-5 pt-3 border-t border-slate-900">
              <button
                type="button"
                onClick={() => { setIsAddBannerOpen(false); setIsEditBannerOpen(false); }}
                className="flex-1 h-10 border border-slate-800 hover:bg-slate-800 text-slate-400 text-xs font-bold rounded-xl cursor-pointer transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!bannerFormTitle.trim()) {
                    alert('กรุณากรอกหัวข้อเด่นก่อนครับ');
                    return;
                  }
                  const payload = {
                    id: editingBanner ? editingBanner.id : undefined,
                    type: bannerFormType,
                    title: bannerFormTitle.trim(),
                    subtitle: bannerFormSubtitle.trim(),
                    coverUrl: bannerFormCoverUrl.trim(),
                    bgGradient: bannerFormBgGradient.trim(),
                    linkUrl: bannerFormLinkUrl.trim(),
                    targetGameId: bannerFormTargetGameId,
                    isActive: bannerFormIsActive,
                    sortOrder: bannerFormSortOrder
                  };
                  try {
                    await saveBanner(payload);
                    const bannerList = await getBanners();
                    setBanners(bannerList);
                    setIsAddBannerOpen(false);
                    setIsEditBannerOpen(false);
                    setToastMessage(editingBanner ? '✏️ แก้ไขแบนเนอร์สำเร็จ!' : '➕ เพิ่มแบนเนอร์สำเร็จ!');
                  } catch (err) {
                    alert('ไม่สามารถเซฟแบนเนอร์ได้: ' + err.message);
                  }
                }}
                className="flex-1 h-10 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl cursor-pointer transition-all shadow-md"
              >
                บันทึกข้อมูล
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN ADD/EDIT CANDIDATE MODAL */}
      {(isAddCandidateOpen || isEditCandidateOpen) && (
        <div className="modal-overlay animate-fade-in" onClick={() => { setIsAddCandidateOpen(false); setIsEditCandidateOpen(false); }}>
          <div className="modal-content w-full max-w-md bg-slate-955 border border-slate-850 rounded-3xl p-6 relative shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-extrabold text-slate-100 mb-4">
              {isEditCandidateOpen ? '✏️ แก้ไขข้อมูลผู้ท้าชิง' : '➕ เพิ่มผู้ท้าชิงใหม่'}
            </h3>

            <div className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="text-slate-400 font-bold">ชื่อเกมผู้ท้าชิง</label>
                <input
                  type="text"
                  value={candidateFormTitle}
                  onChange={(e) => setCandidateFormTitle(e.target.value)}
                  className="glass-input h-9 px-3 rounded-xl text-slate-200"
                  placeholder="เช่น Eternum, Being a DIK..."
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-slate-400 font-bold">รายละเอียดคำอธิบายย่อ (Description)</label>
                <textarea
                  value={candidateFormDescription}
                  onChange={(e) => setCandidateFormDescription(e.target.value)}
                  className="glass-input p-3 rounded-xl text-slate-200 h-20 resize-none"
                  placeholder="เช่น เรื่องราวแนวไซไฟสุดเร้าใจ..."
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-slate-400 font-bold">ลิงก์รูปหน้าปกเกม (Cover Image URL)</label>
                <input
                  type="text"
                  value={candidateFormCoverUrl}
                  onChange={(e) => setCandidateFormCoverUrl(e.target.value)}
                  className="glass-input h-9 px-3 rounded-xl text-slate-200"
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5 pt-3 border-t border-slate-900">
              <button
                type="button"
                onClick={() => { setIsAddCandidateOpen(false); setIsEditCandidateOpen(false); }}
                className="flex-1 h-10 border border-slate-800 hover:bg-slate-800 text-slate-400 text-xs font-bold rounded-xl cursor-pointer transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!candidateFormTitle.trim()) {
                    alert('กรุณากรอกชื่อเกมผู้ท้าชิงก่อนครับ');
                    return;
                  }
                  const payload = {
                    id: editingCandidate ? editingCandidate.id : undefined,
                    title: candidateFormTitle.trim(),
                    description: candidateFormDescription.trim(),
                    coverUrl: candidateFormCoverUrl.trim()
                  };
                  try {
                    await saveVotingCandidate(payload);
                    const candidateList = await getVotingCandidates();
                    setVotingCandidates(candidateList);
                    setIsAddCandidateOpen(false);
                    setIsEditCandidateOpen(false);
                    setToastMessage(editingCandidate ? '✏️ แก้ไขผู้ท้าชิงสำเร็จ!' : '➕ เพิ่มผู้ท้าชิงสำเร็จ!');
                  } catch (err) {
                    alert('ไม่สามารถบันทึกผู้ท้าชิงได้: ' + err.message);
                  }
                }}
                className="flex-1 h-10 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl cursor-pointer transition-all shadow-md"
              >
                บันทึกข้อมูล
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

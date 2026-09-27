import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  auth,
  logoutUser,
  isUserAdmin,
  compressImage,
  compressThumbnail,
} from './firebase';
import {
  subscribeProducts,
  subscribeCategories,
  subscribeAds,
  subscribeTestimonials,
  subscribeSettings,
  saveProduct,
  deleteProduct,
  recordProductView,
  recordProductWaClick,
  incrementProductView,
  saveCategory,
  deleteCategory,
  saveAd,
  deleteAd,
  saveTestimonial,
  deleteTestimonial,
  saveStoreSettings,
  exportFullBackup,
  importFullBackup,
  DEFAULT_SETTINGS,
  recordSiteVisit,
  subscribeStoreStats,
  verifyAdminLogin,
  saveAdminCredentials,
  getAdminCredentials,
  seedDemoProductsToFirestore,
  ensureAdminAuth,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_ADMIN_PASSWORD_PLAIN,
} from './db';
import {
  DEMO_CATEGORIES,
  DEMO_PRODUCTS,
  DEMO_ADS,
  DEMO_TESTIMONIALS,
} from './demoData';
import type { Product, Category, Ad, Testimonial, StoreSettings, StoreStats, AdminCredentials } from './types';
import type { User } from 'firebase/auth';

const BADGES: Record<string, string> = { new: 'جديد', best: 'الأكثر مبيعًا', excl: 'حصري' };
const AD_ICONS = [
  ['fa-bullhorn', '📢 بوق إعلانات وتنبيهات'],
  ['fa-crown', '👑 تاج ملكي فاخر'],
  ['fa-fire', '🔥 عروض نارية وتخفيضات'],
  ['fa-wand-magic-sparkles', '✨ بريق وتميز VIP'],
  ['fa-tags', '🏷️ تنزيلات ومواسم عروض'],
  ['fa-percent', '٪ نسبة خصم وتوفير'],
  ['fa-gift', '🎁 هدايا ومفاجآت'],
  ['fa-truck-fast', '🚚 توصيل وشحن سريع'],
  ['fa-tape', '📏 أخذ مقاسات وتفصيل خاص'],
  ['fa-scissors', '✂️ خياطة وتفصيل يدوي'],
  ['fa-shirt', '👔 أزياء وثياب راقية'],
  ['fa-star', '⭐ نجمة مميزة وموصى بها'],
  ['fa-gem', '💎 تشكيلة جوهرة فاخرة'],
  ['fa-shield-halved', '🛡️ ضمان جودة وأصالة'],
  ['fa-clock', '⏰ عروض محدودة بالوقت'],
  ['fa-box-open', '📦 وصول بضاعة جديدة'],
];
const SORTS: Record<string, string> = {
  new: 'الأحدث',
  old: 'الأقدم',
  asc: 'السعر: من الأقل',
  desc: 'السعر: من الأعلى',
  name: 'الاسم أبجديًا',
};

const fmt = (n: number) => Number(n || 0).toLocaleString('en-US');
const discOf = (p: Product) =>
  p.oldPrice && p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const PLACEHOLDER_IMG =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect fill="%231a1917" width="400" height="400"/><text fill="%23c5a059" x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="bold">براند اليمن</text></svg>';

// Format time string into 12-hour system (e.g. "09:00" -> "9:00 صباحاً" or "22:00" -> "10:00 مساءً")
export function formatTime12h(v?: string, fullArabic: boolean = true): string {
  if (!v) return '';
  const str = String(v).trim();
  if (!str) return '';

  const isPMExplicit = /م|pm|مساء/i.test(str);
  const isAMExplicit = /ص|am|صباح/i.test(str);
  const clean = str.replace(/[^\d:]/g, '');
  const p = clean.split(':');
  if (p.length < 2 && !clean) return str;

  let h = parseInt(p[0] || '0', 10);
  const m = parseInt(p[1] || '0', 10) || 0;
  if (isNaN(h)) return str;

  let isPM = false;
  if (isPMExplicit) {
    isPM = true;
    if (h === 0) h = 12;
    else if (h > 12) h = h % 12 || 12;
  } else if (isAMExplicit) {
    isPM = false;
    if (h === 0) h = 12;
    else if (h > 12) h = h % 12 || 12;
  } else {
    // 24-hour notation
    isPM = h >= 12;
    h = h % 12;
    if (h === 0) h = 12;
  }

  const mStr = m < 10 ? `0${m}` : `${m}`;
  const period = fullArabic ? (isPM ? 'مساءً' : 'صباحاً') : (isPM ? 'م' : 'ص');

  return `${h}:${mStr} ${period}`;
}

export function parseTimeToMinutes(v?: string): number {
  if (!v) return 0;
  const str = String(v).trim();
  const isPM = /م|pm|مساء/i.test(str);
  const isAM = /ص|am|صباح/i.test(str);
  const clean = str.replace(/[^\d:]/g, '');
  const p = clean.split(':');
  let h = parseInt(p[0] || '0', 10);
  const m = parseInt(p[1] || '0', 10) || 0;
  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;
  return h * 60 + m;
}

interface Time12PickerProps {
  label: string;
  name: string;
  defaultValue?: string;
  icon?: string;
}

function Time12Picker({ label, name, defaultValue = '09:00', icon = 'fa-clock' }: Time12PickerProps) {
  const parseVal = (v: string) => {
    const str = String(v || '').trim();
    const isPMExplicit = /م|pm|مساء/i.test(str);
    const clean = str.replace(/[^\d:]/g, '');
    const p = clean.split(':');
    let rawH = parseInt(p[0] || '9', 10);
    const rawM = parseInt(p[1] || '0', 10) || 0;
    let period: 'AM' | 'PM' = 'AM';
    let h12 = rawH;

    if (isPMExplicit || rawH >= 12) {
      period = 'PM';
      h12 = rawH === 12 ? 12 : rawH % 12;
    } else {
      period = 'AM';
      h12 = rawH === 0 ? 12 : rawH;
    }
    if (h12 === 0) h12 = 12;
    return { h: h12, m: rawM, period };
  };

  const initial = parseVal(defaultValue);
  const [hour, setHour] = useState<number>(initial.h);
  const [minute, setMinute] = useState<number>(initial.m);
  const [period, setPeriod] = useState<'AM' | 'PM'>(initial.period);

  useEffect(() => {
    const parsed = parseVal(defaultValue);
    setHour(parsed.h);
    setMinute(parsed.m);
    setPeriod(parsed.period);
  }, [defaultValue]);

  let h24 = hour % 12;
  if (period === 'PM') h24 += 12;
  const h24Str = h24 < 10 ? `0${h24}` : `${h24}`;
  const mStr = minute < 10 ? `0${minute}` : `${minute}`;
  const val24 = `${h24Str}:${mStr}`;
  const preview = `${hour}:${mStr} ${period === 'AM' ? 'صباحاً' : 'مساءً'}`;

  const hoursList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const defaultMinutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  const minutesList = defaultMinutes.includes(minute)
    ? defaultMinutes
    : [...defaultMinutes, minute].sort((a, b) => a - b);

  return (
    <div
      style={{
        background: 'rgba(212, 175, 55, 0.05)',
        border: '1px solid var(--line, rgba(255,255,255,0.12))',
        borderRadius: '10px',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label className="lbl" style={{ margin: 0, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className={`fa-regular ${icon}`} style={{ color: 'var(--gold)' }}></i>
          {label}
        </label>
        <span
          className="badge b-ok"
          style={{
            fontSize: '12px',
            padding: '3px 8px',
            fontWeight: 800,
            letterSpacing: '0.3px',
          }}
        >
          {preview}
        </span>
      </div>

      <input type="hidden" name={name} value={val24} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr', gap: '6px', alignItems: 'center' }}>
        {/* الساعة */}
        <div>
          <label style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>الساعة</label>
          <select
            className="inp"
            value={hour}
            onChange={(e) => setHour(parseInt(e.target.value, 10))}
            style={{
              padding: '8px 4px',
              fontSize: '14px',
              fontWeight: 700,
              textAlign: 'center',
              cursor: 'pointer',
            }}
            aria-label={`${label} - الساعة`}
          >
            {hoursList.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>

        {/* الدقيقة */}
        <div>
          <label style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>الدقيقة</label>
          <select
            className="inp"
            value={minute}
            onChange={(e) => setMinute(parseInt(e.target.value, 10))}
            style={{
              padding: '8px 4px',
              fontSize: '14px',
              fontWeight: 700,
              textAlign: 'center',
              cursor: 'pointer',
            }}
            aria-label={`${label} - الدقيقة`}
          >
            {minutesList.map((m) => (
              <option key={m} value={m}>
                {m < 10 ? `0${m}` : `${m}`}
              </option>
            ))}
          </select>
        </div>

        {/* الفترة */}
        <div>
          <label style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>الفترة</label>
          <select
            className="inp"
            value={period}
            onChange={(e) => setPeriod(e.target.value as 'AM' | 'PM')}
            style={{
              padding: '8px 4px',
              fontSize: '13px',
              fontWeight: 700,
              textAlign: 'center',
              color: period === 'AM' ? '#38bdf8' : '#fbbf24',
              cursor: 'pointer',
            }}
            aria-label={`${label} - الفترة`}
          >
            <option value="AM">صباحاً (ص)</option>
            <option value="PM">مساءً (م)</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--muted)' }}>
        <span>نظام 12 ساعة</span>
        <span>المحدد: <strong>{preview}</strong></span>
      </div>
    </div>
  );
}

export default function App() {
  // State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>(DEMO_PRODUCTS);
  const [categories, setCategories] = useState<Category[]>(DEMO_CATEGORIES);
  const [ads, setAds] = useState<Ad[]>(DEMO_ADS);
  const [testimonials, setTestimonials] = useState<Testimonial[]>(DEMO_TESTIMONIALS);
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);

  const [favs, setFavs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('by_favs') || '[]');
    } catch {
      return [];
    }
  });

  // Navigation & Routing
  const [route, setRoute] = useState<{ path: string; params: string[]; query: Record<string, string> }>({
    path: 'home',
    params: [],
    query: {},
  });

  // UI state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [admSideOpen, setAdmSideOpen] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; msg: string; type?: 'err' | 'ok' }>>([]);

  // Filters
  const [filCats, setFilCats] = useState<string[]>([]);
  const [filColors, setFilColors] = useState<string[]>([]);
  const [filSizes, setFilSizes] = useState<string[]>([]);
  const [filMin, setFilMin] = useState('');
  const [filMax, setFilMax] = useState('');
  const [filSale, setFilSale] = useState(false);
  const [filSort, setFilSort] = useState('new');
  const [prodSearch, setProdSearch] = useState('');

  // Details & Lightbox
  const [selSize, setSelSize] = useState('');
  const [lightbox, setLightbox] = useState<{ open: boolean; images: string[]; index: number; prodId?: string }>({
    open: false,
    images: [],
    index: 0,
  });

  // Admin state
  const [admSearch, setAdmSearch] = useState('');
  const [editingProd, setEditingProd] = useState<Product | null>(null);
  const [prodDraftImages, setProdDraftImages] = useState<string[]>([]);
  const [prodDraftSizes, setProdDraftSizes] = useState<string[]>(['S', 'M', 'L', 'XL']);
  const [prodCustomSizes, setProdCustomSizes] = useState<string>('');
  const [admProdTab, setAdmProdTab] = useState<'published' | 'hidden' | 'all'>('published');
  const toastTimerRef = useRef<number | null>(null);

  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [newCatImg, setNewCatImg] = useState<string>('');
  const [editingAd, setEditingAd] = useState<Ad | null>(null);
  const [newAdLinkType, setNewAdLinkType] = useState<'none' | 'cat' | 'prod' | 'url'>('none');
  const [newAdLinkVal, setNewAdLinkVal] = useState<string>('');
  const [editAdLinkType, setEditAdLinkType] = useState<'none' | 'cat' | 'prod' | 'url'>('none');
  const [editAdLinkVal, setEditAdLinkVal] = useState<string>('');
  const [editingTesti, setEditingTesti] = useState<Testimonial | null>(null);
  const [modalConfirm, setModalConfirm] = useState<{
    title: string;
    msg: string;
    onConfirm: () => void;
  } | null>(null);

  // دالة موحدة لفتح شاشة إضافة أو تعديل المنتج مع ضبط المقاسات كأزرار وخانة مخصصة
  const openEditProduct = (p: Product | null) => {
    const presetSizes = [
      'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL',
      '36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56', '58',
      'مقاس حر (Free Size)', 'تفصيل حسب الطلب', 'جميع المقاسات',
    ];
    if (p) {
      setEditingProd(p);
      setProdDraftImages(p.images ? p.images.slice() : []);
      const matched: string[] = [];
      const custom: string[] = [];
      (p.sizes || []).forEach((s) => {
        const tr = s.trim();
        if (!tr) return;
        if (presetSizes.includes(tr)) {
          matched.push(tr);
        } else {
          custom.push(tr);
        }
      });
      setProdDraftSizes(matched.length > 0 ? matched : (p.sizes && p.sizes.length > 0 ? [] : ['S', 'M', 'L', 'XL']));
      setProdCustomSizes(custom.join('، '));
    } else {
      setEditingProd(null);
      setProdDraftImages([]);
      setProdDraftSizes(['S', 'M', 'L', 'XL']);
      setProdCustomSizes('');
    }
  };

  // Admin credentials session & stats
  const [adminSession, setAdminSession] = useState<{ loggedIn: boolean; username: string }>(() => {
    try {
      const s = sessionStorage.getItem('by_adm_session');
      if (s) {
        const p = JSON.parse(s);
        if (p && p.loggedIn) return p;
      }
    } catch {}
    return { loggedIn: false, username: '' };
  });

  // ضمان اتصال مصادقة المدير بصلاحيات Firestore عند وجود جلسة مسجلة
  useEffect(() => {
    if (adminSession.loggedIn) {
      ensureAdminAuth().catch(() => {});
    }
  }, [adminSession.loggedIn]);

  const [storeStats, setStoreStats] = useState<StoreStats>({
    totalVisits: 0,
    todayVisits: 0,
    todayDate: '',
  });

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [isSeedingDemo, setIsSeedingDemo] = useState(false);
  const [hasCustomCreds, setHasCustomCreds] = useState(false);

  // In-app navigation history stack to ensure reliable back step navigation
  const navStackRef = useRef<string[]>(['#/']);

  // Security password change state
  const [secCurrentPass, setSecCurrentPass] = useState('');
  const [secNewUser, setSecNewUser] = useState('');
  const [secNewPass, setSecNewPass] = useState('');
  const [secConfirmPass, setSecConfirmPass] = useState('');
  const [secLoading, setSecLoading] = useState(false);

  // Check on load if custom credentials exist
  useEffect(() => {
    getAdminCredentials().then((creds) => {
      if (creds && creds.updatedAt) {
        setHasCustomCreds(true);
      }
    });
  }, []);

  // Parse hash on load & hashchange
  useEffect(() => {
    const handleHash = () => {
      let h = window.location.hash || '#/';
      const q: Record<string, string> = {};
      if (h.includes('?')) {
        const [pr, qs] = h.split('?');
        h = pr;
        new URLSearchParams(qs).forEach((v, k) => (q[k] = v));
      }
      const parts = h.replace(/^#\/?/, '').split('/').map(decodeURIComponent).filter(Boolean);
      setRoute({
        path: parts[0] || 'home',
        params: parts,
        query: q,
      });

      // Maintain stack
      const stack = navStackRef.current;
      const last = stack[stack.length - 1];
      if (last !== h) {
        stack.push(h);
      }

      window.scrollTo(0, 0);
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigate = (hash: string) => {
    setDrawerOpen(false);
    setSearchOpen(false);
    setFilterSheetOpen(false);
    setSortSheetOpen(false);
    setAdmSideOpen(false);
    if (window.location.hash === hash) {
      // Force trigger hash change handler if navigating to same hash
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      window.location.hash = hash;
    }
  };

  const goBack = () => {
    // 1. أولاً: إغلاق أي نافذة منبثقة أو شيت أو قائمة مفتوحة خطوة بخطوة
    if (lightbox.open) {
      setLightbox((prev) => ({ ...prev, open: false }));
      return;
    }
    if (modalConfirm) {
      setModalConfirm(null);
      return;
    }
    if (editingProd) {
      setEditingProd(null);
      return;
    }
    if (editingCat) {
      setEditingCat(null);
      return;
    }
    if (editingAd) {
      setEditingAd(null);
      return;
    }
    if (editingTesti) {
      setEditingTesti(null);
      return;
    }
    if (filterSheetOpen) {
      setFilterSheetOpen(false);
      return;
    }
    if (sortSheetOpen) {
      setSortSheetOpen(false);
      return;
    }
    if (searchOpen) {
      setSearchOpen(false);
      return;
    }
    if (drawerOpen) {
      setDrawerOpen(false);
      return;
    }
    if (admSideOpen) {
      setAdmSideOpen(false);
      return;
    }

    // 2. إذا كان المدير داخل صفحة فرعية بلوحة التحكم (مثل /admin/products) يعود للرئيسية /admin
    if (route.params[0] === 'admin' && route.params[1]) {
      navigate('#/admin');
      return;
    }

    // 3. التراجع خطوة واحدة في السجل الداخلي للصفحات
    const stack = navStackRef.current;
    if (stack.length > 1) {
      stack.pop(); // نزيل الصفحة الحالية
      const prev = stack[stack.length - 1];
      if (prev && prev !== (window.location.hash || '#/')) {
        navigate(prev);
        return;
      }
    }

    // 4. مسار احتياطي ذكي وفوري إذا لم يتوفر سجل سابق
    if (route.path === 'product') {
      const p = products.find((x) => x.id === route.params[1]);
      if (p?.categoryId) {
        navigate(`#/category/${p.categoryId}`);
      } else {
        navigate('#/products');
      }
    } else if (route.path === 'category') {
      navigate('#/categories');
    } else if (route.path === 'categories' || route.path === 'products' || route.path === 'contact') {
      navigate('#/');
    } else if (route.params[0] === 'admin') {
      navigate('#/');
    } else {
      navigate('#/');
    }
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Subscriptions with deleted items filtering
  useEffect(() => {
    const getDeletedIds = (key: string): string[] => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    };

    const unsubs = [
      subscribeProducts((prods) => {
        const del = getDeletedIds('by_deleted_prod_ids');
        const isInit = localStorage.getItem('by_products_init') === 'true' || del.length > 0;
        let list: Product[] = [];
        if (prods.length > 0) {
          list = prods.filter((p) => !del.includes(p.id));
        } else if (isInit) {
          list = [];
        } else {
          list = DEMO_PRODUCTS.filter((p) => !del.includes(p.id));
        }
        setProducts(list);
      }),
      subscribeCategories((cats) => {
        const del = getDeletedIds('by_deleted_cat_ids');
        let list: Category[] = [];
        if (cats.length > 0) {
          list = cats.filter((c) => !del.includes(c.id));
        } else {
          list = DEMO_CATEGORIES.filter((c) => !del.includes(c.id));
        }
        setCategories(list);
      }),
      subscribeAds((a) => {
        const del = getDeletedIds('by_deleted_ad_ids');
        let list: Ad[] = [];
        if (a.length > 0) {
          list = a.filter((item) => !del.includes(item.id));
        } else {
          list = DEMO_ADS.filter((item) => !del.includes(item.id));
        }
        setAds(list);
      }),
      subscribeTestimonials((t) => {
        const del = getDeletedIds('by_deleted_testi_ids');
        let list: Testimonial[] = [];
        if (t.length > 0) {
          list = t.filter((item) => !del.includes(item.id));
        } else {
          list = DEMO_TESTIMONIALS.filter((item) => !del.includes(item.id));
        }
        setTestimonials(list);
      }),
      subscribeSettings((newSettings) => {
        setSettings(newSettings);
        document.title = `${newSettings.shopName} | ${newSettings.shopSub}`;
        const fav = document.getElementById('favIcon') as HTMLLinkElement | null;
        if (fav) fav.href = newSettings.logoUrl || DEFAULT_SETTINGS.logoUrl;
      }),
    ];
    return () => unsubs.forEach((u) => u && u());
  }, []);

  // تسجيل زيارة المتجر الحقيقية لكل جلسة متصفح وتحديث إحصائيات اليوم في Firestore
  useEffect(() => {
    recordSiteVisit().catch((err) => console.warn('Record site visit:', err));
  }, []);

  // اشتراك الإحصائيات الحقيقية للمتجر لحظياً من Firestore
  useEffect(() => {
    const unsub = subscribeStoreStats((stats) => {
      setStoreStats(stats);
    });
    return () => unsub && unsub();
  }, []);

  // تسجيل مشاهدة حقيقية للمنتج في Firestore عند فتح صفحة تفاصيله
  useEffect(() => {
    if (route.path === 'product' && route.params[1]) {
      recordProductView(route.params[1]).catch(() => {});
    }
  }, [route.path, route.params[1]]);

  // إشعار واحد فقط يظهر ويختفي ويعاد تجديده عند تكرار الضغط بدون أي تراكم
  const showToast = (msg: string, type: 'err' | 'ok' = 'ok') => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    const id = uid('tst');
    setToasts([{ id, msg, type }]);
    toastTimerRef.current = window.setTimeout(() => {
      setToasts([]);
      toastTimerRef.current = null;
    }, 2500);
  };

  // Admin dashboard list view tab
  const [dashListTab, setDashListTab] = useState<'all' | 'latest' | 'views'>('all');

  // Theme state & toggle (Light / Dark Mode)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('by_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'dark';
  });

  // مؤشر الإعلان النشط مع تدوير سلس عند وجود أكثر من إعلان نشط
  const [activeAdIndex, setActiveAdIndex] = useState(0);

  useEffect(() => {
    const activeAds = ads.filter((a) => a.active);
    if (activeAds.length <= 1) return;
    const interval = setInterval(() => {
      setActiveAdIndex((prev) => (prev + 1) % activeAds.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [ads]);

  useEffect(() => {
    try {
      localStorage.setItem('by_theme', theme);
    } catch {}
    if (theme === 'light') {
      document.documentElement.classList.add('theme-light');
      document.body.classList.add('theme-light');
    } else {
      document.documentElement.classList.remove('theme-light');
      document.body.classList.remove('theme-light');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      showToast(next === 'light' ? 'تم تفعيل الوضع النهاري (Light Mode)' : 'تم تفعيل الوضع الليلي');
      return next;
    });
  };

  const toggleFav = (id: string) => {
    let next: string[];
    if (favs.includes(id)) {
      next = favs.filter((f) => f !== id);
      showToast('أُزيل من المفضلة');
    } else {
      next = [...favs, id];
      showToast('أُضيف إلى المفضلة');
    }
    setFavs(next);
    localStorage.setItem('by_favs', JSON.stringify(next));
  };

  // المدير: إما عبر جلسة اسم المستخدم وكلمة المرور أو حساب Google المعتمد
  const isAdmin = useMemo(
    () => adminSession.loggedIn || isUserAdmin(currentUser),
    [adminSession.loggedIn, currentUser]
  );

  const handleAdminLogout = async () => {
    setAdminSession({ loggedIn: false, username: '' });
    sessionStorage.removeItem('by_adm_session');
    await logoutUser();
    setLoginUsername('');
    setLoginPassword('');
    setAuthError(null);
    showToast('تم تسجيل الخروج بنجاح');
    navigate('#/');
  };

  // Check store opening hours (supports 12-hour and 24-hour systems)
  const isOpenNow = () => {
    const o = parseTimeToMinutes(settings.hoursOpen || '09:00');
    const c = parseTimeToMinutes(settings.hoursClose || '22:00');
    const now = new Date();
    const t = now.getHours() * 60 + now.getMinutes();
    if (c <= o) return t >= o || t < c;
    return t >= o && t < c;
  };

  const waNumberClean = () => String(settings.whatsapp || '201503256581').replace(/\D/g, '');

  const openWhatsApp = (product?: Product | null) => {
    const num = waNumberClean();
    if (!/^\d{8,15}$/.test(num)) {
      showToast('يرجى ضبط رقم واتساب صحيح من لوحة المدير', 'err');
      return;
    }

    // تسجيل نقرة طلب واتساب الحقيقية في Firestore للمنتج
    if (product && product.id) {
      recordProductWaClick(product.id).catch(() => {});
    }

    let msg: string;
    if (product) {
      const cat = categories.find((c) => c.id === product.categoryId)?.name || 'عام';
      msg = (settings.waTemplate || DEFAULT_SETTINGS.waTemplate)
        .replace('{name}', product.name)
        .replace('{price}', fmt(product.price))
        .replace('{currency}', settings.currency)
        .replace('{category}', cat)
        .replace('{color}', product.color || '-')
        .replace('{size}', selSize || 'حسب الطلب')
        .replace('{shop}', settings.shopName);
    } else {
      msg = (settings.waGeneral || DEFAULT_SETTINGS.waGeneral).replace('{shop}', settings.shopName);
    }
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // Filtered Products for public
  const visibleProducts = useMemo(() => {
    let list = products.filter((p) => p.published || isAdmin);
    if (route.params[0] === 'category' && route.params[1]) {
      list = list.filter((p) => p.categoryId === route.params[1]);
    }
    if (filCats.length) {
      list = list.filter((p) => filCats.includes(p.categoryId));
    }
    if (filColors.length) {
      list = list.filter((p) => p.color && filColors.includes(p.color));
    }
    if (filSizes.length) {
      list = list.filter((p) => (p.sizes || []).some((s) => filSizes.includes(s)));
    }
    if (filSale) {
      list = list.filter((p) => discOf(p) > 0);
    }
    if (filMin !== '') {
      list = list.filter((p) => p.price >= Number(filMin));
    }
    if (filMax !== '') {
      list = list.filter((p) => p.price <= Number(filMax));
    }
    if (prodSearch.trim()) {
      const q = prodSearch.trim().toLowerCase();
      list = list.filter((p) => {
        const cat = categories.find((c) => c.id === p.categoryId)?.name || '';
        return (p.name + ' ' + cat + ' ' + (p.color || '') + ' ' + (p.fabric || '')).toLowerCase().includes(q);
      });
    }
    const sortFn: Record<string, (a: Product, b: Product) => number> = {
      new: (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      old: (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
      asc: (a, b) => a.price - b.price,
      desc: (a, b) => b.price - a.price,
      name: (a, b) => a.name.localeCompare(b.name, 'ar'),
    };
    return list.sort(sortFn[filSort] || sortFn.new);
  }, [products, categories, route.params, filCats, filColors, filSizes, filSale, filMin, filMax, prodSearch, filSort, isAdmin]);

  // Product Views Counter
  useEffect(() => {
    if (route.path === 'product' && route.params[1]) {
      const pid = route.params[1];
      const viewedKey = `by_viewed_${pid}`;
      if (!sessionStorage.getItem(viewedKey)) {
        sessionStorage.setItem(viewedKey, '1');
        incrementProductView(pid);
      }
    }
  }, [route.path, route.params]);

  // Common Header
  const renderHeader = (showBack = false) => (
    <header className="hdr" id="mainHeader">
      <div className="hdr-in">
        <div className="hdr-side">
          <button
            className="icon-btn"
            onClick={() => setSearchOpen(true)}
            aria-label="بحث"
            id="btnSearch"
          >
            <i className="fa-solid fa-magnifying-glass"></i>
          </button>
          <button
            className="icon-btn wa-ic"
            onClick={() => navigate('#/contact')}
            aria-label="واتساب"
            id="btnHeaderWa"
          >
            <i className="fa-brands fa-whatsapp"></i>
          </button>
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'light' ? 'الوضع الليلي' : 'الوضع النهاري'}
            title={theme === 'light' ? 'تفعيل الوضع الليلي' : 'تفعيل الوضع النهاري'}
            id="btnToggleThemeHeader"
          >
            <i className={theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun'}></i>
          </button>
        </div>

        <button
          className="logo-btn"
          onClick={() => navigate('#/')}
          aria-label={settings.shopName}
          id="btnLogoHome"
        >
          <span className="logo-ring">
            <img className="logo-img" src={settings.logoUrl || DEFAULT_SETTINGS.logoUrl} alt={settings.shopName} />
          </span>
        </button>

        <nav className="hdr-links">
          <a
            className={route.path === 'home' ? 'on' : ''}
            onClick={() => navigate('#/')}
          >
            الرئيسية
          </a>
          <a
            className={route.path === 'categories' ? 'on' : ''}
            onClick={() => navigate('#/categories')}
          >
            الأقسام
          </a>
          <a
            className={route.path === 'products' ? 'on' : ''}
            onClick={() => navigate('#/products')}
          >
            المنتجات
          </a>
          <a
            className={route.path === 'contact' ? 'on' : ''}
            onClick={() => navigate('#/contact')}
          >
            تواصل
          </a>
        </nav>

        <div className="hdr-side end">
          {showBack ? (
            <button
              className="icon-btn"
              onClick={goBack}
              aria-label="رجوع للخلف"
              title="رجوع للخلف"
              id="btnBack"
            >
              <i className="fa-solid fa-arrow-right"></i>
            </button>
          ) : (
            <button
              className="icon-btn"
              onClick={() => setDrawerOpen(true)}
              aria-label="القائمة"
              id="btnOpenDrawer"
            >
              <i className="fa-solid fa-bars"></i>
            </button>
          )}
        </div>
      </div>
    </header>
  );

  // Common Ad Bar
  const renderAdBar = () => {
    const activeAds = ads.filter((a) => a.active);
    if (!activeAds.length) return null;
    const activeAd = activeAds[activeAdIndex % activeAds.length] || activeAds[0];
    const hasLink = activeAd.linkType && activeAd.linkType !== 'none' && activeAd.linkValue;
    return (
      <div
        className={`adbar kind-${activeAd.kind || 'gold'}`}
        id={`adbar_${activeAd.id}`}
        onClick={() => {
          if (activeAd.linkType === 'cat' && activeAd.linkValue) {
            navigate(`#/category/${activeAd.linkValue}`);
          } else if (activeAd.linkType === 'prod' && activeAd.linkValue) {
            navigate(`#/product/${activeAd.linkValue}`);
          } else if (activeAd.linkType === 'url' && activeAd.linkValue) {
            window.open(activeAd.linkValue, '_blank');
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="adbar-shine"></div>
        <div className="ad-gem-bubble">
          <i className={`fa-solid ${activeAd.icon || 'fa-bullhorn'} ad-pulse-icon`}></i>
        </div>
        <div className="ad-main-wrap">
          <div className="ad-header-row">
            <div className="ad-pill-badge">
              <span className="ad-pill-spark"></span>
              <span>عرض مميز</span>
            </div>
            {activeAds.length > 1 && (
              <span className="ad-counter-dot">
                {(activeAdIndex % activeAds.length) + 1} / {activeAds.length}
              </span>
            )}
          </div>
          <p className="ad-t">{activeAd.text}</p>
        </div>
        {hasLink ? (
          <div className="ad-cta-pill">
            <span>عرض الآن</span>
            <i className="fa-solid fa-arrow-left"></i>
          </div>
        ) : (
          <div className="ad-sparkle-pill">
            <i className="fa-solid fa-sparkles"></i>
          </div>
        )}
      </div>
    );
  };

  // Product Card
  const renderProductCard = (p: Product) => {
    const isFav = favs.includes(p.id);
    const disc = discOf(p);
    const catName = categories.find((c) => c.id === p.categoryId)?.name || 'قسم';
    return (
      <article className="p-card reveal in" key={p.id} id={`pCard_${p.id}`}>
        <div className="p-img">
          <img
            loading="lazy"
            decoding="async"
            src={p.images[0] || PLACEHOLDER_IMG}
            alt={p.name}
            className="img-l ld"
          />
          {/* زر المفضلة في الركن المقابل للشارات */}
          <button
            className={`fav ${isFav ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleFav(p.id);
            }}
            aria-label="مفضلة"
            id={`favBtn_${p.id}`}
          >
            <i className={`fa-${isFav ? 'solid' : 'regular'} fa-heart`}></i>
          </button>

          {/* حزمة الشارات المستقلة في الركن العلوي - مرتبة عمودياً بمسافة واضحة وبدون أي تداخل مع نصوص أخرى */}
          {(disc > 0 || (p.badge && BADGES[p.badge])) && (
            <div className="p-badges-stack">
              {disc > 0 && (
                <span className="p-badge-disc">
                  <i className="fa-solid fa-percent"></i>
                  <span>-{disc}%</span>
                </span>
              )}
              {p.badge && BADGES[p.badge] && (
                <span className={`p-badge-tag p-badge-${p.badge}`}>
                  {p.badge === 'new' && <i className="fa-solid fa-sparkles"></i>}
                  {p.badge === 'best' && <i className="fa-solid fa-fire"></i>}
                  {p.badge === 'excl' && <i className="fa-solid fa-crown"></i>}
                  <span>{BADGES[p.badge]}</span>
                </span>
              )}
            </div>
          )}

          {/* شارة القسم في الأسفل بمفردها بكامل العرض بدون مزاحمة لأي شارة أخرى */}
          <span className="p-cat" title={catName}>{catName}</span>
        </div>
        <div className="p-body">
          <h4>{p.name}</h4>
          <div className="p-price">
            {fmt(p.price)} <small>{settings.currency}</small>
            {disc > 0 && <span className="old-price">{fmt(p.oldPrice || 0)}</span>}
          </div>
          <button
            className="btn btn-line btn-sm btn-blk"
            onClick={() => navigate(`#/product/${p.id}`)}
            id={`viewBtn_${p.id}`}
          >
            عرض التفاصيل <i className="fa-solid fa-arrow-left"></i>
          </button>
        </div>
      </article>
    );
  };

  // Footer
  const renderFooter = () => {
    const open = isOpenNow();
    return (
      <footer className="foot" id="mainFooter">
        <span className="logo-ring">
          <img className="logo-img" src={settings.logoUrl || DEFAULT_SETTINGS.logoUrl} alt={settings.shopName} />
        </span>
        <b>
          {settings.shopName}{' '}
          <span className="muted" style={{ fontSize: '11px' }}>
            {settings.shopNameEn}
          </span>
        </b>

        <div className="soc-row">
          {settings.socFb && (
            <a className="soc" href={settings.socFb} target="_blank" rel="noopener" aria-label="Facebook">
              <i className="fa-brands fa-facebook-f"></i>
            </a>
          )}
          {settings.socIg && (
            <a className="soc" href={settings.socIg} target="_blank" rel="noopener" aria-label="Instagram">
              <i className="fa-brands fa-instagram"></i>
            </a>
          )}
          {settings.socTt && (
            <a className="soc" href={settings.socTt} target="_blank" rel="noopener" aria-label="TikTok">
              <i className="fa-brands fa-tiktok"></i>
            </a>
          )}
          {settings.socTw && (
            <a className="soc" href={settings.socTw} target="_blank" rel="noopener" aria-label="Twitter">
              <i className="fa-brands fa-x-twitter"></i>
            </a>
          )}
        </div>

        {settings.address && (
          <div className="foot-line">
            <i className="fa-solid fa-location-dot"></i> {settings.address}
          </div>
        )}
        <div className="foot-line">
          <i className="fa-regular fa-clock"></i> ساعات العمل: {formatTime12h(settings.hoursOpen, true)} - {formatTime12h(settings.hoursClose, true)}{' '}
          <span className={`badge ${open ? 'b-ok' : 'b-no'}`}>{open ? 'مفتوح الآن' : 'مغلق'}</span>
        </div>
        <div className="orn">
          <span>❖</span>
        </div>
        <small>
          {settings.tagline} — {settings.shopSub}
        </small>
        <br />
        <div className="dev-credit-box" id="developerCredit">
          <div className="dev-credit-inner">
            <span className="dev-credit-label">
              <i className="fa-solid fa-code"></i> تصميم وتطوير :
            </span>
            <span className="dev-credit-name">محمد نبيل السحيقي</span>
          </div>
        </div>
        <br />
        <small className="muted">© {new Date().getFullYear()} جميع الحقوق محفوظة</small>
      </footer>
    );
  };

  // ----------------------------------------------------
  // VIEWS
  // ----------------------------------------------------

  // 1. Home View
  const renderHome = () => {
    const published = products.filter((p) => p.published);
    const latest = [...published].slice(0, 8);
    const featured = published.filter((p) => p.featured).slice(0, 8);
    const offers = published.filter((p) => discOf(p) > 0).slice(0, 8);

    return (
      <main className="wrap" id="homePage">
        {renderAdBar()}

        {/* Hero Section */}
        <section className="hero reveal in" id="heroSection">
          <span className="logo-ring big">
            <img className="logo-img" src={settings.logoUrl || DEFAULT_SETTINGS.logoUrl} alt={settings.shopName} />
          </span>
          <h1 className="g-txt">{settings.shopName}</h1>
          <h2>{settings.shopSub}</h2>
          <p className="hero-tag">{settings.tagline}</p>
          <div className="feats">
            <div className="feat">
              <i className="fa-solid fa-shirt"></i>
              <span>تصاميم عصرية</span>
            </div>
            <div className="feat">
              <i className="fa-solid fa-scissors"></i>
              <span>تفصيل احترافي</span>
            </div>
            <div className="feat">
              <i className="fa-solid fa-shield-halved"></i>
              <span>جودة عالية</span>
            </div>
          </div>
          <button className="btn btn-gold" onClick={() => navigate('#/products')} id="btnHeroShop">
            تصفح التصاميم <i className="fa-solid fa-arrow-left"></i>
          </button>
        </section>

        {/* Categories Section */}
        {settings.homeShow.cats !== false && (
          <section id="homeCatsSec">
            <div className="sec-h reveal in">
              <h3>
                <i className="fa-solid fa-layer-group"></i> الأقسام الرئيسية
              </h3>
              <button onClick={() => navigate('#/categories')}>عرض الكل</button>
            </div>
            {categories.length === 0 ? (
              <div className="empty">
                <i className="fa-solid fa-scissors"></i>
                <b>لا توجد أقسام حالياً</b>
                <span>يمكنك إضافة الأقسام والمنتجات من لوحة تحكم المدير.</span>
              </div>
            ) : (
              <div className="cats-grid">
                {categories.slice(0, 4).map((cat) => {
                  const count = published.filter((p) => p.categoryId === cat.id).length;
                  return (
                    <div
                      className="cat-card reveal in"
                      key={cat.id}
                      onClick={() => navigate(`#/category/${cat.id}`)}
                      id={`homeCat_${cat.id}`}
                    >
                      <img
                        loading="lazy"
                        src={cat.image || PLACEHOLDER_IMG}
                        alt={cat.name}
                      />
                      <div className="c-n">
                        <b className="cat-title">{cat.name}</b>
                        <span className="cat-count-badge">
                          <i className="fa-solid fa-box-open"></i>
                          <span>{count} منتج</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Latest Products */}
        {settings.homeShow.latest !== false && (
          <section id="homeLatestSec">
            <div className="sec-h reveal in">
              <h3>
                <i className="fa-solid fa-sparkles"></i> أحدث التصاميم
              </h3>
              <button onClick={() => navigate('#/products')}>عرض الكل</button>
            </div>
            {latest.length === 0 ? (
              <div className="empty">
                <i className="fa-solid fa-bag-shopping"></i>
                <b>لا توجد منتجات منشورة حالياً</b>
                <span>أضف منتجاتك الجديدة من لوحة الإدارة لتبدأ بالظهور هنا.</span>
              </div>
            ) : (
              <div className="h-scroll">{latest.map(renderProductCard)}</div>
            )}
          </section>
        )}

        {/* Special Offers */}
        {settings.homeShow.sale !== false && offers.length > 0 && (
          <section id="homeSaleSec">
            <div className="sec-h reveal in">
              <h3>
                <i className="fa-solid fa-fire"></i> العروض والخصومات
              </h3>
              <button onClick={() => navigate('#/products')}>عرض الكل</button>
            </div>
            <div className="h-scroll">{offers.map(renderProductCard)}</div>
          </section>
        )}

        {/* Featured Products */}
        {settings.homeShow.feat !== false && featured.length > 0 && (
          <section id="homeFeatSec">
            <div className="sec-h reveal in">
              <h3>
                <i className="fa-solid fa-crown"></i> التصاميم المميزة
              </h3>
              <button onClick={() => navigate('#/products')}>عرض الكل</button>
            </div>
            <div className="p-grid">{featured.map(renderProductCard)}</div>
          </section>
        )}

        {/* Testimonials */}
        {settings.homeShow.testi !== false && testimonials.length > 0 && (
          <section id="homeTestiSec">
            <div className="sec-h reveal in">
              <h3>
                <i className="fa-solid fa-star"></i> آراء عملائنا
              </h3>
            </div>
            <div className="h-scroll">
              {testimonials.map((t) => (
                <div className="testi-card card reveal in" key={t.id} id={`testi_${t.id}`}>
                  <div className="t-stars">{'★'.repeat(t.stars)}</div>
                  <p>"{t.text}"</p>
                  <b>— {t.name}</b>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* About Store */}
        {settings.homeShow.about !== false && settings.aboutText && (
          <section id="homeAboutSec">
            <div className="sec-h reveal in">
              <h3>
                <i className="fa-solid fa-circle-info"></i> عن {settings.shopName}
              </h3>
            </div>
            <div className="card about-card reveal in">
              <p>{settings.aboutText}</p>
            </div>
          </section>
        )}

        {renderFooter()}
      </main>
    );
  };

  // 2. Categories View
  const renderCategoriesView = () => (
    <main className="wrap" id="categoriesPage">
      {renderAdBar()}
      <div className="page-t reveal in">
        <h2>الأقسام</h2>
      </div>
      {categories.length === 0 ? (
        <div className="empty">
          <i className="fa-solid fa-scissors"></i>
          <b>لا توجد أقسام حالياً</b>
          <span>لم تتم إضافة أي قسم بعد. يمكن للمدير إضافة الأقسام من لوحة التحكم.</span>
        </div>
      ) : (
        <div className="cats-grid">
          {categories.map((cat) => {
            const count = products.filter((p) => p.published && p.categoryId === cat.id).length;
            return (
              <div
                className="cat-card reveal in"
                key={cat.id}
                onClick={() => navigate(`#/category/${cat.id}`)}
                id={`catCard_${cat.id}`}
              >
                <img
                  loading="lazy"
                  src={cat.image || PLACEHOLDER_IMG}
                  alt={cat.name}
                />
                <div className="c-n">
                  <b className="cat-title">{cat.name}</b>
                  <span className="cat-count-badge">
                    <i className="fa-solid fa-box-open"></i>
                    <span>{count} منتج</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {renderFooter()}
    </main>
  );

  // 3. Products List View
  const renderProductsView = () => {
    const isCat = route.path === 'category';
    const catId = route.params[1];
    const cat = categories.find((c) => c.id === catId);
    const title = isCat && cat ? cat.name : 'كل المنتجات';

    return (
      <main className="wrap" id="productsPage">
        {renderAdBar()}
        <div className="page-t reveal in">
          <h2>{title}</h2>
        </div>

        <input
          className="inp"
          placeholder="ابحث داخل المنتجات (اسم، لون، قماش)..."
          value={prodSearch}
          onChange={(e) => setProdSearch(e.target.value)}
          style={{ marginBottom: '12px' }}
          id="searchProductsInp"
        />

        {/* Filter bar */}
        <div className="fil-bar">
          <button
            className="pill"
            onClick={() => setFilterSheetOpen(true)}
            id="openFilterSheetBtn"
          >
            <i className="fa-solid fa-sliders"></i> تصفية
            {filCats.length + filColors.length + filSizes.length + (filSale ? 1 : 0) > 0 &&
              ` (${filCats.length + filColors.length + filSizes.length + (filSale ? 1 : 0)})`}
          </button>
          <button
            className="pill"
            onClick={() => setSortSheetOpen(true)}
            id="openSortSheetBtn"
          >
            {SORTS[filSort] || 'الترتيب'} <i className="fa-solid fa-chevron-down"></i>
          </button>
          <span className="fil-count">{visibleProducts.length} منتج</span>
        </div>

        {visibleProducts.length === 0 ? (
          <div className="empty">
            <i className="fa-solid fa-scissors"></i>
            <b>لا توجد منتجات مطابقة</b>
            <span>جرّب تغيير خيارات البحث أو الفلترة.</span>
          </div>
        ) : (
          <div className="p-grid" id="productsGrid">
            {visibleProducts.map(renderProductCard)}
          </div>
        )}

        {renderFooter()}
      </main>
    );
  };

  // 4. Product Details View
  const renderProductDetails = () => {
    const pId = route.params[1];
    const p = products.find((x) => x.id === pId);
    if (!p) {
      return (
        <main className="wrap">
          <div className="empty">
            <i className="fa-solid fa-scissors"></i>
            <b>المنتج غير موجود</b>
            <span>ربما تم حذفه أو لم يعد متاحًا.</span>
          </div>
        </main>
      );
    }

    const catName = categories.find((c) => c.id === p.categoryId)?.name || 'غير مصنف';
    const disc = discOf(p);
    const isFav = favs.includes(p.id);

    return (
      <main className="wrap" id="productDetailsPage">
        {/* Gallery */}
        <div className="gal reveal in">
          <div
            className="gal-main"
            onClick={() => setLightbox({ open: true, images: p.images, index: 0, prodId: p.id })}
            id="productMainImgWrapper"
          >
            <img
              id="mainProductImg"
              loading="lazy"
              decoding="async"
              src={p.images[0] || PLACEHOLDER_IMG}
              alt={p.name}
            />
            {/* حزمة الشارات أعلى صورة المنتج بتفاصيل واضحة */}
            {(disc > 0 || (p.badge && BADGES[p.badge])) && (
              <div className="p-badges-stack gal-badges-stack">
                {disc > 0 && (
                  <span className="p-badge-disc" style={{ fontSize: '11px', padding: '5px 12px' }}>
                    <i className="fa-solid fa-percent"></i>
                    <span>خصم -{disc}%</span>
                  </span>
                )}
                {p.badge && BADGES[p.badge] && (
                  <span className={`p-badge-tag p-badge-${p.badge}`} style={{ fontSize: '11px', padding: '5px 12px' }}>
                    {p.badge === 'new' && <i className="fa-solid fa-sparkles"></i>}
                    {p.badge === 'best' && <i className="fa-solid fa-fire"></i>}
                    {p.badge === 'excl' && <i className="fa-solid fa-crown"></i>}
                    <span>{BADGES[p.badge]}</span>
                  </span>
                )}
              </div>
            )}
            <span className="zoom">
              <i className="fa-solid fa-magnifying-glass-plus"></i>
            </span>
          </div>

          {p.images.length > 1 && (
            <div className="gal-thumbs">
              {p.images.map((im, idx) => (
                <button
                  key={idx}
                  className={idx === 0 ? 'on' : ''}
                  onClick={(e) => {
                    const mainImg = document.getElementById('mainProductImg') as HTMLImageElement | null;
                    if (mainImg) mainImg.src = im;
                    const btns = (e.currentTarget.parentElement?.querySelectorAll('button') || []);
                    btns.forEach((b, j) => b.classList.toggle('on', j === idx));
                  }}
                  id={`thumbBtn_${idx}`}
                >
                  <img src={im || PLACEHOLDER_IMG} alt={`${p.name} ${idx + 1}`} loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <h1 className="d-title g-txt">{p.name}</h1>

        <div className="price-row">
          <div className="price-lg">
            {fmt(p.price)} <small>{settings.currency}</small>
            {disc > 0 && (
              <>
                <span className="old-price">
                  {fmt(p.oldPrice || 0)} {settings.currency}
                </span>{' '}
                <span className="badge b-no">-{disc}%</span>
              </>
            )}
          </div>
          <span className={`badge ${p.stock ? 'b-ok' : 'b-no'}`}>
            <i className={`fa-solid ${p.stock ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>{' '}
            {p.stock ? 'متوفر للتفصيل' : 'غير متوفر'}
          </span>
        </div>

        <div className="chips">
          <span className="chip on" style={{ cursor: 'default' }}>
            <i className="fa-solid fa-tag"></i> {catName}
          </span>
          {p.badge && BADGES[p.badge] && (
            <span
              className={`p-badge-tag p-badge-${p.badge}`}
              style={{ cursor: 'default', fontSize: '11px', padding: '5px 12px' }}
            >
              {p.badge === 'new' && <i className="fa-solid fa-sparkles"></i>}
              {p.badge === 'best' && <i className="fa-solid fa-fire"></i>}
              {p.badge === 'excl' && <i className="fa-solid fa-crown"></i>}
              <span>{BADGES[p.badge]}</span>
            </span>
          )}
        </div>

        {p.description && <p className="d-desc">{p.description}</p>}

        <div className="card spec">
          <h5>
            <i className="fa-solid fa-list-ul"></i> مواصفات وتفاصيل المنتج
          </h5>
          {p.color && (
            <div className="spec-row">
              <span className="k">
                <i className="fa-solid fa-palette"></i> اللون
              </span>
              <span className="v">
                <span className="c-dot" style={{ background: p.colorHex || '#d4af37' }}></span>
                {p.color}
              </span>
            </div>
          )}
          {p.fabric && (
            <div className="spec-row">
              <span className="k">
                <i className="fa-solid fa-scroll"></i> نوع القماش
              </span>
              <span className="v">{p.fabric}</span>
            </div>
          )}
          {p.sizes && p.sizes.length > 0 && (
            <div className="spec-row">
              <span className="k">
                <i className="fa-solid fa-ruler-combined"></i> المقاسات
              </span>
              <span className="v">
                <span className="chips" style={{ justifyContent: 'flex-end' }}>
                  {p.sizes.map((sz) => (
                    <button
                      key={sz}
                      className={`chip ${selSize === sz ? 'on' : ''}`}
                      onClick={() => setSelSize(selSize === sz ? '' : sz)}
                      id={`sizeChip_${sz}`}
                    >
                      {sz}
                    </button>
                  ))}
                </span>
              </span>
            </div>
          )}
          {p.details && (
            <div className="spec-row">
              <span className="k">
                <i className="fa-solid fa-scissors"></i> التفصيل والخياطة
              </span>
              <span className="v" style={{ maxWidth: '70%', lineHeight: '1.8' }}>
                {p.details}
              </span>
            </div>
          )}
          <div className="spec-row">
            <span className="k">
              <i className="fa-regular fa-eye"></i> المشاهدات
            </span>
            <span className="v">{fmt(p.views || 0)}</span>
          </div>
        </div>

        <div className="d-acts">
          <button className="btn btn-wa" onClick={() => openWhatsApp(p)} id="btnOrderWa">
            <i className="fa-brands fa-whatsapp"></i> اطلب عبر واتساب
          </button>
          <button
            className="btn btn-line"
            onClick={() => toggleFav(p.id)}
            id="btnFavDetails"
          >
            <i className={`fa-${isFav ? 'solid' : 'regular'} fa-heart`}></i>{' '}
            {isFav ? 'محفوظ' : 'حفظ بالمفضلة'}
          </button>
        </div>

        {renderFooter()}
      </main>
    );
  };

  // 5. Contact View
  const renderContactView = () => {
    const open = isOpenNow();
    return (
      <main className="wrap" id="contactPage">
        {renderAdBar()}
        <div className="card wa-box reveal in">
          <div className="wa-hero-ic">
            <i className="fa-brands fa-whatsapp"></i>
          </div>
          <h2>تواصل معنا عبر واتساب</h2>
          <p>يسعدنا خدمتك والرد على كافة استفسارات التفصيل وطلب المقاسات والأسعار مباشرة.</p>

          <div className="foot-line" style={{ marginBottom: '16px' }}>
            <i className="fa-solid fa-phone"></i> +{waNumberClean()}{' '}
            <span className={`badge ${open ? 'b-ok' : 'b-no'}`}>{open ? 'مفتوح الآن' : 'مغلق'}</span>
          </div>

          <button className="btn btn-wa btn-blk" onClick={() => openWhatsApp()} id="btnDirectWa">
            <i className="fa-brands fa-whatsapp"></i> محادثة مباشرة عبر واتساب
          </button>

          <div className="orn">
            <span>❖</span>
          </div>

          {settings.address && (
            <div className="foot-line">
              <i className="fa-solid fa-location-dot"></i> {settings.address}
            </div>
          )}
          {settings.mapUrl && (
            <a
              className="btn btn-line btn-sm"
              style={{ marginTop: '10px' }}
              href={settings.mapUrl}
              target="_blank"
              rel="noopener"
              id="linkMap"
            >
              <i className="fa-solid fa-map-location-dot"></i> موقعنا على الخريطة
            </a>
          )}
          <div className="foot-line">
            <i className="fa-regular fa-clock"></i> ساعات العمل: يوميًا من {formatTime12h(settings.hoursOpen, true)} إلى {formatTime12h(settings.hoursClose, true)}
          </div>

          <div className="soc-row" style={{ marginTop: '16px' }}>
            {settings.socFb && (
              <a className="soc" href={settings.socFb} target="_blank" rel="noopener">
                <i className="fa-brands fa-facebook-f"></i>
              </a>
            )}
            {settings.socIg && (
              <a className="soc" href={settings.socIg} target="_blank" rel="noopener">
                <i className="fa-brands fa-instagram"></i>
              </a>
            )}
            {settings.socTt && (
              <a className="soc" href={settings.socTt} target="_blank" rel="noopener">
                <i className="fa-brands fa-tiktok"></i>
              </a>
            )}
            {settings.socTw && (
              <a className="soc" href={settings.socTw} target="_blank" rel="noopener">
                <i className="fa-brands fa-x-twitter"></i>
              </a>
            )}
          </div>

          <small className="muted">
            {settings.shopName} .. {settings.tagline}
          </small>
        </div>
        {renderFooter()}
      </main>
    );
  };

  // ----------------------------------------------------
  // ADMIN VIEWS (Firebase Auth Google Login & Firestore)
  // ----------------------------------------------------

  // Admin Login Screen (اسم مستخدم وكلمة مرور + خيار Google الاختياري)
  const renderAdminLogin = () => (
    <div className="login" id="adminLoginPage">
      <div className="card lg-card" style={{ maxWidth: '440px' }}>
        <span className="logo-ring big">
          <img className="logo-img" src={settings.logoUrl || DEFAULT_SETTINGS.logoUrl} alt={settings.shopName} />
        </span>
        <div className="lg-lock">
          <i className="fa-solid fa-shield-halved"></i>
        </div>
        <h2>دخول المدير</h2>
        <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
          يرجى إدخال اسم المستخدم وكلمة المرور للوصول إلى لوحة تحكم المتجر
        </p>

        {authError && <div className="lg-err show">{authError}</div>}

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!loginUsername.trim() || !loginPassword.trim()) {
              setAuthError('يرجى كتابة اسم المستخدم وكلمة المرور');
              return;
            }
            setLoginLoading(true);
            setAuthError(null);
            try {
              const res = await verifyAdminLogin(loginUsername, loginPassword);
              if (res.success) {
                const cleanName = loginUsername.trim();
                const sess = { loggedIn: true, username: cleanName };
                setAdminSession(sess);
                try {
                  sessionStorage.setItem('by_adm_session', JSON.stringify(sess));
                } catch {}
                setLoginUsername('');
                setLoginPassword('');
                showToast(`أهلاً بك يا مدير (${cleanName}) في لوحة التحكم`, 'ok');
              } else {
                setAuthError(res.error || 'اسم المستخدم أو كلمة المرور غير صحيحة. يرجى التأكد وإعادة المحاولة.');
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل الدخول';
              setAuthError(msg);
            } finally {
              setLoginLoading(false);
            }
          }}
          style={{ width: '100%', marginTop: '16px', textAlign: 'right' }}
        >
          <label className="lbl">
            <i className="fa-solid fa-user" style={{ marginLeft: '6px', color: 'var(--gold-l)' }}></i>
            اسم المستخدم
          </label>
          <input
            className="inp"
            type="text"
            required
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck="false"
            value={loginUsername}
            onChange={(e) => setLoginUsername(e.target.value)}
            placeholder="أدخل اسم المستخدم"
            id="admUsernameInp"
          />

          <div style={{ height: '12px' }}></div>

          <label className="lbl">
            <i className="fa-solid fa-lock" style={{ marginLeft: '6px', color: 'var(--gold-l)' }}></i>
            كلمة المرور
          </label>
          <div style={{ position: 'relative' }}>
            <input
              className="inp"
              type={showLoginPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="أدخل كلمة المرور"
              id="admPasswordInp"
              style={{ paddingLeft: '42px' }}
            />
            <button
              type="button"
              onClick={() => setShowLoginPassword(!showLoginPassword)}
              aria-label={showLoginPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: 'var(--muted)',
                cursor: 'pointer',
                fontSize: '15px',
                padding: '4px',
              }}
            >
              <i className={`fa-solid ${showLoginPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
            </button>
          </div>

          <div style={{ height: '18px' }}></div>

          <button
            type="submit"
            className="btn btn-gold btn-blk"
            disabled={loginLoading}
            id="btnAdminPasswordLogin"
          >
            {loginLoading ? (
              <>
                <i className="fa-solid fa-spinner fa-spin"></i> جارٍ التحقق...
              </>
            ) : (
              <>
                <i className="fa-solid fa-right-to-bracket"></i> تسجيل الدخول للمدير
              </>
            )}
          </button>
        </form>

        <button
          className="btn btn-line btn-sm btn-blk"
          style={{ marginTop: '14px' }}
          onClick={() => navigate('#/')}
          id="btnReturnStore"
        >
          <i className="fa-solid fa-arrow-right"></i> العودة للمتجر
        </button>
      </div>
    </div>
  );

  // Admin Shell
  const renderAdminDashboard = () => {
    const sub = route.params[1] || '';

    return (
      <div className="adm" id="adminDashboard">
        <div className="adm-main">
          <div className="adm-hdr">
            <button
              className="icon-btn adm-menu-btn"
              onClick={() => setAdmSideOpen(true)}
              aria-label="القائمة"
              id="btnAdminMenu"
            >
              <i className="fa-solid fa-bars"></i>
            </button>
            {sub !== '' && (
              <button
                className="icon-btn"
                onClick={() => navigate('#/admin')}
                aria-label="رجوع للوحة الرئيسية"
                title="رجوع للوحة الرئيسية"
                id="btnAdminBack"
              >
                <i className="fa-solid fa-arrow-right"></i>
              </button>
            )}
            <h2>
              <i className="fa-solid fa-shield-halved" style={{ color: 'var(--gold)', marginInlineEnd: '8px' }}></i>
              لوحة تحكم المدير
            </h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginInlineStart: 'auto' }}>
              <button
                className="icon-btn"
                onClick={toggleTheme}
                title={theme === 'light' ? 'تفعيل الوضع الليلي' : 'تفعيل الوضع النهاري'}
                aria-label="تبديل الوضع"
                id="btnAdminToggleTheme"
              >
                <i className={theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun'}></i>
              </button>
              <button
                className="btn btn-line btn-sm"
                onClick={() => navigate('#/')}
                id="btnAdminViewStore"
              >
                <i className="fa-solid fa-globe"></i> عرض الموقع
              </button>
            </div>
          </div>

          {sub === '' && renderAdminStats()}
          {sub === 'products' && renderAdminProducts()}
          {sub === 'product' && renderAdminProductForm()}
          {sub === 'categories' && renderAdminCategories()}
          {sub === 'ads' && renderAdminAds()}
          {sub === 'testi' && renderAdminTestimonials()}
          {sub === 'settings' && renderAdminSettings()}
          {sub === 'security' && renderAdminSecurity()}
        </div>

        {/* Sidebar */}
        <aside className={`adm-side ${admSideOpen ? 'open' : ''}`} id="adminSidebar">
          <div className="dr-h">
            <span className="logo-ring">
              <img className="logo-img" src={settings.logoUrl || DEFAULT_SETTINGS.logoUrl} alt={settings.shopName} />
            </span>
            <div>
              <b>{settings.shopName}</b>
              <small>قاعدة بيانات Firestore</small>
            </div>
          </div>

          <button
            className={`ad-l ${sub === '' ? 'on' : ''}`}
            onClick={() => {
              setAdmSideOpen(false);
              navigate('#/admin');
            }}
          >
            <i className="fa-solid fa-house"></i> الرئيسية
          </button>
          <button
            className={`ad-l ${sub === 'products' && admProdTab === 'published' ? 'on' : ''}`}
            onClick={() => {
              setAdmSideOpen(false);
              setAdmProdTab('published');
              navigate('#/admin/products');
            }}
          >
            <i className="fa-solid fa-boxes-stacked"></i> المنتجات المعروضة ({products.filter((p) => p.published).length})
          </button>
          <button
            className={`ad-l ${sub === 'products' && admProdTab === 'hidden' ? 'on' : ''}`}
            onClick={() => {
              setAdmSideOpen(false);
              setAdmProdTab('hidden');
              navigate('#/admin/products');
            }}
          >
            <i className="fa-solid fa-eye-slash" style={{ color: products.some((p) => !p.published) ? 'var(--gold-l)' : undefined }}></i>
            المنتجات المخفية ({products.filter((p) => !p.published).length})
          </button>
          <button
            className={`ad-l ${sub === 'categories' ? 'on' : ''}`}
            onClick={() => {
              setAdmSideOpen(false);
              navigate('#/admin/categories');
            }}
          >
            <i className="fa-solid fa-layer-group"></i> الأقسام ({categories.length})
          </button>
          <button
            className="ad-l"
            onClick={() => {
              setAdmSideOpen(false);
              openEditProduct(null);
              navigate('#/admin/product/new');
            }}
          >
            <i className="fa-solid fa-plus"></i> إضافة منتج جديد
          </button>
          <button
            className={`ad-l ${sub === 'ads' ? 'on' : ''}`}
            onClick={() => {
              setAdmSideOpen(false);
              navigate('#/admin/ads');
            }}
          >
            <i className="fa-solid fa-bullhorn"></i> الإعلانات والبانرات
          </button>
          <button
            className={`ad-l ${sub === 'testi' ? 'on' : ''}`}
            onClick={() => {
              setAdmSideOpen(false);
              navigate('#/admin/testi');
            }}
          >
            <i className="fa-solid fa-star"></i> آراء العملاء
          </button>
          <button
            className={`ad-l ${sub === 'settings' ? 'on' : ''}`}
            onClick={() => {
              setAdmSideOpen(false);
              navigate('#/admin/settings');
            }}
          >
            <i className="fa-solid fa-gear"></i> الإعدادات والنسخ الاحتياطي
          </button>
          <button
            className={`ad-l ${sub === 'security' ? 'on' : ''}`}
            onClick={() => {
              setAdmSideOpen(false);
              navigate('#/admin/security');
            }}
          >
            <i className="fa-solid fa-shield-halved"></i> الأمان والحساب
          </button>

          <div className="ad-side-foot">
            <button
              className="ad-l"
              onClick={handleAdminLogout}
            >
              <i className="fa-solid fa-right-from-bracket"></i> تسجيل الخروج
            </button>
          </div>
        </aside>
      </div>
    );
  };

  // Admin Stats (إحصائيات حقيقية من Firestore + زر تثبيت المنتجات التجريبية)
  const renderAdminStats = () => {
    const pub = products.filter((p) => p.published).length;
    const views = products.reduce((acc, p) => acc + (p.views || 0), 0);
    const waClicks = products.reduce((acc, p) => acc + (p.waClicks || 0), 0);
    const offers = products.filter((p) => discOf(p) > 0).length;
    const convRate = views > 0 ? ((waClicks / views) * 100).toFixed(1) : '0';

    return (
      <>
        {/* شريط الإجراء السريع: تثبيت المنتجات التجريبية في Firestore */}
        <div
          className="card"
          style={{
            padding: '16px 20px',
            marginBottom: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '14px',
            border: '1px solid rgba(197, 160, 89, 0.45)',
            background: 'linear-gradient(135deg, rgba(197,160,89,0.1) 0%, rgba(26,25,23,0.3) 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '12px',
                background: 'rgba(197, 160, 89, 0.2)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--gold-l)',
                fontSize: '22px',
                flexShrink: 0,
              }}
            >
              <i className="fa-solid fa-cloud-arrow-up"></i>
            </div>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '15px' }}>
                تثبيت كافة المنتجات التجريبية في قاعدة البيانات (Firestore)
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                إضافة كافة تصاميم براند اليمن الـ 15 (أثواب، صديريات، بشوت، وأشمغة) مع الأقسام والإعلانات في Firestore بضغطة زر.
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-gold"
            disabled={isSeedingDemo}
            onClick={async () => {
              try {
                setIsSeedingDemo(true);
                showToast('جارٍ كتابة وتثبيت المنتجات التجريبية في Firestore...');
                const count = await seedDemoProductsToFirestore();
                showToast(`تم تثبيت ${count} منتجاً تجريبياً وجميع الأقسام بنجاح في Firestore!`, 'ok');
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'فشل تثبيت المنتجات التجريبية';
                showToast(msg, 'err');
              } finally {
                setIsSeedingDemo(false);
              }
            }}
            id="btnSeedDemoProducts"
          >
            {isSeedingDemo ? (
              <>
                <i className="fa-solid fa-spinner fa-spin"></i> جارٍ التثبيت...
              </>
            ) : (
              <>
                <i className="fa-solid fa-wand-magic-sparkles"></i> تثبيت المنتجات التجريبية الآن
              </>
            )}
          </button>
        </div>

        {/* شبكة الإحصائيات الحقيقية */}
        <div className="stats">
          <div className="card stat" style={{ borderTop: '3px solid var(--gold)' }}>
            <div className="s-ic">
              <i className="fa-solid fa-users"></i>
            </div>
            <div>
              <div className="s-num">{fmt(storeStats.totalVisits)}</div>
              <div className="s-lb">زيارات الموقع الكلية</div>
            </div>
          </div>

          <div className="card stat" style={{ borderTop: '3px solid var(--gold-l)' }}>
            <div className="s-ic">
              <i className="fa-solid fa-calendar-day"></i>
            </div>
            <div>
              <div className="s-num">{fmt(storeStats.todayVisits)}</div>
              <div className="s-lb">زيارات اليوم (حقيقي)</div>
            </div>
          </div>

          <div className="card stat">
            <div className="s-ic">
              <i className="fa-regular fa-eye"></i>
            </div>
            <div>
              <div className="s-num">{fmt(views)}</div>
              <div className="s-lb">مشاهدات المنتجات</div>
            </div>
          </div>

          <div className="card stat" style={{ borderTop: '3px solid #25D366' }}>
            <div className="s-ic" style={{ color: '#25D366' }}>
              <i className="fa-brands fa-whatsapp"></i>
            </div>
            <div>
              <div className="s-num">{fmt(waClicks)}</div>
              <div className="s-lb">نقرات طلب واتساب</div>
            </div>
          </div>

          <div className="card stat">
            <div className="s-ic">
              <i className="fa-solid fa-arrow-trend-up"></i>
            </div>
            <div>
              <div className="s-num">{convRate}%</div>
              <div className="s-lb">معدل تحويل الطلب</div>
            </div>
          </div>

          <div
            className="card stat"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              setAdmProdTab('published');
              navigate('#/admin/products');
            }}
            title="عرض المنتجات المعروضة"
          >
            <div className="s-ic">
              <i className="fa-solid fa-boxes-stacked"></i>
            </div>
            <div>
              <div className="s-num">{pub}</div>
              <div className="s-lb">منتجات معروضة للزوار</div>
            </div>
          </div>

          <div
            className="card stat"
            style={{
              cursor: 'pointer',
              borderTop: products.length - pub > 0 ? '3px solid var(--gold-l)' : undefined,
            }}
            onClick={() => {
              setAdmProdTab('hidden');
              navigate('#/admin/products');
            }}
            title="عرض المنتجات المخفية وإدارتها"
          >
            <div className="s-ic" style={{ color: products.length - pub > 0 ? 'var(--gold-l)' : undefined }}>
              <i className="fa-solid fa-eye-slash"></i>
            </div>
            <div>
              <div className="s-num">{products.length - pub}</div>
              <div className="s-lb">منتجات مخفية (اضغط للعرض)</div>
            </div>
          </div>

          <div className="card stat">
            <div className="s-ic">
              <i className="fa-solid fa-layer-group"></i>
            </div>
            <div>
              <div className="s-num">{categories.length}</div>
              <div className="s-lb">الأقسام المتاحة</div>
            </div>
          </div>

          <div className="card stat">
            <div className="s-ic">
              <i className="fa-solid fa-fire"></i>
            </div>
            <div>
              <div className="s-num">{offers}</div>
              <div className="s-lb">عروض خصم نشطة</div>
            </div>
          </div>
        </div>

        {/* تبديل وعرض قوائم لوحة المدير بسلاسة وبكامل العرض */}
        <div className="adm-dash-filter-bar">
          <button
            type="button"
            className={`chip ${dashListTab === 'all' ? 'on' : ''}`}
            onClick={() => setDashListTab('all')}
          >
            <i className="fa-solid fa-layer-group"></i> عرض القائمتين معاً
          </button>
          <button
            type="button"
            className={`chip ${dashListTab === 'latest' ? 'on' : ''}`}
            onClick={() => setDashListTab('latest')}
          >
            <i className="fa-solid fa-clock-rotate-left"></i> آخر المنتجات ({products.slice(0, 5).length})
          </button>
          <button
            type="button"
            className={`chip ${dashListTab === 'views' ? 'on' : ''}`}
            onClick={() => setDashListTab('views')}
          >
            <i className="fa-solid fa-chart-line"></i> الأكثر مشاهدة ({products.slice(0, 5).length})
          </button>
        </div>

        <div className="adm-dash-cols">
          {(dashListTab === 'all' || dashListTab === 'latest') && (
            <div className="adm-dash-col-card">
              <div className="sec-h" style={{ marginTop: 0 }}>
                <h3>
                  <i className="fa-solid fa-clock-rotate-left"></i> آخر المنتجات المضافة
                </h3>
              </div>
              {products.slice(0, 5).map((p) => (
                <div className="m-row" key={p.id}>
                  <img className="m-img" src={p.images[0] || PLACEHOLDER_IMG} alt="" />
                  <div className="m-inf">
                    <b>{p.name}</b>
                    <span>
                      {categories.find((c) => c.id === p.categoryId)?.name} — {fmt(p.price)} {settings.currency}
                    </span>
                  </div>
                  <button
                    className="ib"
                    onClick={() => {
                      setEditingProd(p);
                      setProdDraftImages(p.images.slice());
                      navigate(`#/admin/product/${p.id}`);
                    }}
                    title="تعديل"
                  >
                    <i className="fa-solid fa-pen"></i>
                  </button>
                </div>
              ))}
              {products.length === 0 && (
                <div className="empty" style={{ padding: '20px' }}>
                  لا توجد منتجات حتى الآن.
                </div>
              )}
            </div>
          )}

          {(dashListTab === 'all' || dashListTab === 'views') && (
            <div className="adm-dash-col-card">
              <div className="sec-h" style={{ marginTop: 0 }}>
                <h3>
                  <i className="fa-solid fa-chart-line"></i> الأكثر مشاهدة
                </h3>
              </div>
              {[...products]
                .sort((a, b) => (b.views || 0) - (a.views || 0))
                .slice(0, 5)
                .map((p) => (
                  <div className="m-row" key={p.id}>
                    <img className="m-img" src={p.images[0] || PLACEHOLDER_IMG} alt="" />
                    <div className="m-inf">
                      <b>{p.name}</b>
                      <span>
                        <i className="fa-regular fa-eye"></i> {fmt(p.views || 0)} مشاهدة —{' '}
                        <i className="fa-brands fa-whatsapp" style={{ color: '#25D366' }}></i> {fmt(p.waClicks || 0)} طلب
                      </span>
                    </div>
                    <button
                      className="ib"
                      onClick={() => {
                        setEditingProd(p);
                        setProdDraftImages(p.images.slice());
                        navigate(`#/admin/product/${p.id}`);
                      }}
                      title="تعديل"
                    >
                      <i className="fa-solid fa-pen"></i>
                    </button>
                  </div>
                ))}
              {products.length === 0 && (
                <div className="empty" style={{ padding: '20px' }}>
                  لا توجد بيانات مشاهدات بعد.
                </div>
              )}
            </div>
          )}
        </div>
      </>
    );
  };

  // Admin Products List (قسم المنتجات المعروضة والمخفية)
  const renderAdminProducts = () => {
    const publishedProducts = products.filter((p) => p.published);
    const hiddenProducts = products.filter((p) => !p.published);

    let filtered = products;
    if (admProdTab === 'published') {
      filtered = publishedProducts;
    } else if (admProdTab === 'hidden') {
      filtered = hiddenProducts;
    }

    const list = filtered.filter((p) =>
      p.name.toLowerCase().includes(admSearch.trim().toLowerCase())
    );

    return (
      <>
        {/* شريط الأدوات الرئيسي */}
        <div className="adm-toolbar">
          <input
            className="inp"
            placeholder="ابحث عن منتج بالاسم..."
            value={admSearch}
            onChange={(e) => setAdmSearch(e.target.value)}
            id="admSearchInp"
          />
          <button
            className="btn btn-gold"
            onClick={() => {
              openEditProduct(null);
              navigate('#/admin/product/new');
            }}
            id="btnAdminAddProd"
          >
            <i className="fa-solid fa-plus"></i> إضافة منتج جديد
          </button>
        </div>

        {/* أزرار التبويب: شريط مقسم ومنتظم في صف واحد على كل الشاشات */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '6px',
            marginBottom: '16px',
            background: 'var(--card)',
            padding: '5px',
            borderRadius: '14px',
            border: '1px solid var(--line)',
          }}
        >
          <button
            type="button"
            className={`btn btn-sm ${admProdTab === 'published' ? 'btn-gold' : 'btn-line'}`}
            onClick={() => setAdmProdTab('published')}
            style={{
              padding: '8px 4px',
              borderRadius: '10px',
              fontSize: '12px',
              fontWeight: 800,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              border: admProdTab === 'published' ? undefined : 'none',
              background: admProdTab === 'published' ? undefined : 'transparent',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <i className="fa-solid fa-eye" style={{ fontSize: '11px' }}></i>
              المعروضة
            </span>
            <span style={{ fontSize: '11px', fontWeight: 900 }}>
              ({publishedProducts.length})
            </span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${admProdTab === 'hidden' ? 'btn-gold' : 'btn-line'}`}
            onClick={() => setAdmProdTab('hidden')}
            style={{
              padding: '8px 4px',
              borderRadius: '10px',
              fontSize: '12px',
              fontWeight: 800,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              border: admProdTab === 'hidden' ? undefined : 'none',
              background: admProdTab === 'hidden' ? undefined : 'transparent',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <i
                className="fa-solid fa-eye-slash"
                style={{ fontSize: '11px', color: hiddenProducts.length > 0 && admProdTab !== 'hidden' ? 'var(--gold-l)' : undefined }}
              ></i>
              المخفية
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 900,
                color: hiddenProducts.length > 0 && admProdTab !== 'hidden' ? 'var(--gold-l)' : undefined,
              }}
            >
              ({hiddenProducts.length})
            </span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${admProdTab === 'all' ? 'btn-gold' : 'btn-line'}`}
            onClick={() => setAdmProdTab('all')}
            style={{
              padding: '8px 4px',
              borderRadius: '10px',
              fontSize: '12px',
              fontWeight: 800,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              border: admProdTab === 'all' ? undefined : 'none',
              background: admProdTab === 'all' ? undefined : 'transparent',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <i className="fa-solid fa-boxes-stacked" style={{ fontSize: '11px' }}></i>
              الكل
            </span>
            <span style={{ fontSize: '11px', fontWeight: 900 }}>
              ({products.length})
            </span>
          </button>
        </div>

        {/* تنبيه إرشادي في قسم المنتجات المخفية */}
        {admProdTab === 'hidden' && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '12px',
              background: 'rgba(212, 175, 55, 0.08)',
              border: '1px solid rgba(212, 175, 55, 0.25)',
              marginBottom: '16px',
              fontSize: '13px',
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <i className="fa-solid fa-circle-info" style={{ color: 'var(--gold-l)', fontSize: '18px' }}></i>
            <div>
              <b>قسم المنتجات المخفية:</b> المنتجات هنا لا تظهر للزوار في المتجر. يمكنك إعادة إظهار أي منتج للزوار بالضغط على زر <b>«إظهار في المتجر»</b> أو تعديله أو حذفه نهائياً.
            </div>
          </div>
        )}

        {list.length === 0 ? (
          <div className="empty">
            {admProdTab === 'hidden' ? (
              <>
                <i className="fa-solid fa-eye" style={{ fontSize: '32px', color: 'var(--gold)' }}></i>
                <b>لا توجد أي منتجات مخفية حالياً</b>
                <span>كافة منتجات المتجر معروضة ونشطة للزوار. عند إخفاء أي منتج سينتقل تلقائياً إلى هذا القسم.</span>
              </>
            ) : admProdTab === 'published' ? (
              <>
                <i className="fa-solid fa-eye-slash" style={{ fontSize: '32px', color: 'var(--gold)' }}></i>
                <b>لا توجد منتجات معروضة حالياً</b>
                <span>جميع المنتجات موجودة في قسم المنتجات المخفية. اضغط على قسم "المخفية" بالأعلى لإظهارها.</span>
              </>
            ) : (
              <>
                <i className="fa-solid fa-scissors"></i>
                <b>لا توجد منتجات مطابقة للبحث</b>
                <span>اضغط على زر "إضافة منتج جديد" أو جرب كتابة اسم آخر.</span>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {list.map((p) => {
              const catName = categories.find((c) => c.id === p.categoryId)?.name || 'غير محدد';
              const disc = discOf(p);
              return (
                <div
                  key={p.id}
                  id={`admProdRow_${p.id}`}
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--line)',
                    borderRight: !p.published ? '4px solid var(--gold-l)' : '4px solid #10b981',
                    borderRadius: '14px',
                    padding: '14px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {/* الجزء العلوي: الصورة والمعلومات بالكامل بدون ضغط */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <img
                      src={p.images[0] || PLACEHOLDER_IMG}
                      alt={p.name}
                      style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '10px',
                        objectFit: 'cover',
                        border: '1px solid var(--line)',
                        flexShrink: 0,
                      }}
                    />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* اسم المنتج والشارات */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--ivory)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                          {p.name}
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {!p.published ? (
                            <span
                              style={{
                                background: 'rgba(212, 175, 55, 0.15)',
                                color: 'var(--gold-l)',
                                border: '1px solid rgba(212, 175, 55, 0.4)',
                                fontSize: '10px',
                                padding: '2px 7px',
                                borderRadius: '5px',
                                fontWeight: 800,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <i className="fa-solid fa-eye-slash" style={{ fontSize: '9px' }}></i> مخفي
                            </span>
                          ) : (
                            <span
                              style={{
                                background: 'rgba(16, 185, 129, 0.12)',
                                color: '#10b981',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                fontSize: '10px',
                                padding: '2px 7px',
                                borderRadius: '5px',
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <i className="fa-solid fa-check" style={{ fontSize: '9px' }}></i> معروض
                            </span>
                          )}
                          {disc > 0 && <span className="badge b-no" style={{ fontSize: '9px', padding: '2px 6px' }}>-{disc}%</span>}
                          {p.badge && BADGES[p.badge] && (
                            <span className={`p-badge-tag p-badge-${p.badge}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
                              {BADGES[p.badge]}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* القسم والمشاهدات والطلبات */}
                      <div style={{ fontSize: '11.5px', color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--ivory)', fontWeight: 600 }}>{catName}</span>
                        <span>•</span>
                        <span><i className="fa-regular fa-eye" style={{ marginLeft: '2px' }}></i> {fmt(p.views || 0)} مشاهدة</span>
                        <span>•</span>
                        <span style={{ color: '#25D366' }}><i className="fa-brands fa-whatsapp" style={{ marginLeft: '2px' }}></i> {fmt(p.waClicks || 0)} طلب</span>
                      </div>

                      {/* السعر */}
                      <div className="p-price" style={{ margin: 0, fontSize: '14px', fontWeight: 800 }}>
                        {fmt(p.price)} <small style={{ fontSize: '11px', color: 'var(--gold-l)' }}>{settings.currency}</small>
                        {disc > 0 && <span className="old-price" style={{ marginRight: '6px', fontSize: '11.5px' }}>{fmt(p.oldPrice || 0)}</span>}
                      </div>
                    </div>
                  </div>

                  {/* خط فاصل ناعم */}
                  <div style={{ height: '1px', background: 'var(--line)', margin: '10px 0', opacity: 0.6 }}></div>

                  {/* الجزء السفلي: أزرار التحكم والإجراءات بشكل منظم وواسع */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    {/* زر الإظهار / الإخفاء المباشر */}
                    <button
                      type="button"
                      className={`btn btn-sm ${p.published ? 'btn-line' : 'btn-gold'}`}
                      style={{
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 800,
                        borderRadius: '8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                      title={p.published ? 'إخفاء المنتج عن الزوار' : 'إظهار المنتج في المتجر للزوار'}
                      onClick={async () => {
                        const newPub = !p.published;
                        const updated = { ...p, published: newPub };
                        setProducts((prev) => prev.map((item) => (item.id === p.id ? updated : item)));
                        try {
                          await saveProduct(updated);
                          showToast(
                            newPub
                              ? 'تم إظهار المنتج في المتجر بنجاح'
                              : 'تم إخفاء المنتج ونقله إلى قسم المنتجات المخفية'
                          );
                        } catch (err: unknown) {
                          const errMsg = err instanceof Error ? err.message : 'فشل تحديث حالة المنتج';
                          showToast(errMsg, 'err');
                        }
                      }}
                    >
                      <i className={`fa-solid ${p.published ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                      {p.published ? 'إخفاء عن الزوار' : 'إظهار في المتجر'}
                    </button>

                    {/* أزرار الإجراءات (تعديل، نسخ، حذف) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-line"
                        style={{ padding: '6px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '8px' }}
                        title="تعديل المنتج"
                        onClick={() => {
                          openEditProduct(p);
                          navigate(`#/admin/product/${p.id}`);
                        }}
                      >
                        <i className="fa-solid fa-pen" style={{ marginLeft: '4px' }}></i> تعديل
                      </button>

                      <button
                        type="button"
                        className="ib"
                        style={{ width: '32px', height: '32px', borderRadius: '8px' }}
                        title="نسخ المنتج"
                        onClick={async () => {
                          const cloned: Product = {
                            ...p,
                            id: uid('p'),
                            name: `${p.name} (نسخة)`,
                            published: false,
                            views: 0,
                            createdAt: new Date().toISOString(),
                          };
                          setProducts((prev) => [cloned, ...prev]);
                          await saveProduct(cloned);
                          showToast('تم إنشاء نسخة من المنتج في قسم المخفية');
                        }}
                      >
                        <i className="fa-solid fa-clone"></i>
                      </button>

                      <button
                        type="button"
                        className="ib danger"
                        style={{ width: '32px', height: '32px', borderRadius: '8px' }}
                        title="حذف نهائي"
                        onClick={() => {
                          setModalConfirm({
                            title: 'حذف المنتج نهائياً',
                            msg: `هل أنت متأكد من حذف المنتج (${p.name}) من قاعدة البيانات نهائياً؟ لن يمكن التراجع عن هذا الإجراء.`,
                            onConfirm: async () => {
                              try {
                                setProducts((prev) => prev.filter((item) => item.id !== p.id));
                                await deleteProduct(p.id);
                                showToast('تم حذف المنتج بنجاح من قاعدة البيانات');
                              } catch (err: unknown) {
                                console.error('Error deleting product:', err);
                                const errMsg = err instanceof Error ? err.message : 'فشل حذف المنتج من قاعدة البيانات';
                                showToast(`تعذر حذف المنتج: ${errMsg}`, 'err');
                              }
                            },
                          });
                        }}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  // Admin Product Form (Add / Edit)
  const renderAdminProductForm = () => {
    const isNew = route.params[2] === 'new' || !editingProd;

    const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const data = new FormData(form);

      if (prodDraftImages.length === 0) {
        showToast('يرجى إضافة صورة واحدة على الأقل للمنتج', 'err');
        return;
      }

      if (prodDraftImages.length > 5) {
        showToast('الحد الأقصى لصور المنتج هو 5 صور', 'err');
        return;
      }

      // دمج المقاسات المحددة بالأزرار مع المقاسات المكتوبة يدوياً بدون تكرار
      const customParsed = prodCustomSizes
        .split(/[,،\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const allSelectedSizes = Array.from(new Set([...prodDraftSizes, ...customParsed]));
      if (allSelectedSizes.length === 0) {
        allSelectedSizes.push('حسب الطلب');
      }

      const prodToSave: Product = {
        id: editingProd?.id || uid('p'),
        name: String(data.get('name') || '').trim(),
        price: Number(data.get('price')) || 0,
        oldPrice: Number(data.get('oldPrice')) || 0,
        badge: String(data.get('badge') || ''),
        categoryId: String(data.get('categoryId') || ''),
        color: String(data.get('color') || ''),
        colorHex: String(data.get('colorHex') || '#233462'),
        sizes: allSelectedSizes,
        fabric: String(data.get('fabric') || ''),
        description: String(data.get('description') || ''),
        details: String(data.get('details') || ''),
        published: data.get('published') === 'on',
        stock: data.get('stock') === 'on',
        featured: data.get('featured') === 'on',
        images: prodDraftImages.slice(0, 5),
        views: editingProd?.views || 0,
        createdAt: editingProd?.createdAt || new Date().toISOString(),
      };

      try {
        await saveProduct(prodToSave);
        showToast(isNew ? 'تمت إضافة المنتج بنجاح إلى Firestore' : 'تم حفظ تعديلات المنتج بنجاح');
        navigate('#/admin/products');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'فشل حفظ المنتج';
        showToast(message, 'err');
      }
    };

    return (
      <div className="card" style={{ padding: '20px' }}>
        <div className="page-t">
          <h2>{isNew ? 'إضافة منتج جديد' : 'تعديل المنتج'}</h2>
        </div>

        <form onSubmit={handleFormSubmit} id="productEditForm">
          <div className="lbl">صور المنتج (حد أقصى 5 صور — تُضغط تلقائياً بدقة 900px وجودة JPEG 0.7)</div>
          <div className="imgs">
            {prodDraftImages.map((im, i) => (
              <div className="im" key={i}>
                {i === 0 && <span className="main-badge">رئيسية</span>}
                <img src={im || PLACEHOLDER_IMG} alt={`صورة ${i + 1}`} />
                <div className="im-acts">
                  {i !== 0 && (
                    <button
                      type="button"
                      title="تعيين رئيسية"
                      onClick={() => {
                        const copy = [...prodDraftImages];
                        const [picked] = copy.splice(i, 1);
                        copy.unshift(picked);
                        setProdDraftImages(copy);
                      }}
                    >
                      <i className="fa-solid fa-star"></i>
                    </button>
                  )}
                  {i > 0 && (
                    <button
                      type="button"
                      title="تقديم"
                      onClick={() => {
                        const copy = [...prodDraftImages];
                        [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
                        setProdDraftImages(copy);
                      }}
                    >
                      <i className="fa-solid fa-arrow-right"></i>
                    </button>
                  )}
                  {i < prodDraftImages.length - 1 && (
                    <button
                      type="button"
                      title="تأخير"
                      onClick={() => {
                        const copy = [...prodDraftImages];
                        [copy[i + 1], copy[i]] = [copy[i], copy[i + 1]];
                        setProdDraftImages(copy);
                      }}
                    >
                      <i className="fa-solid fa-arrow-left"></i>
                    </button>
                  )}
                  <button
                    type="button"
                    title="حذف"
                    onClick={() => {
                      setProdDraftImages((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>
              </div>
            ))}

            {prodDraftImages.length < 5 && (
              <label className="im-add" htmlFor="prodImgUploadInp">
                <i className="fa-solid fa-camera"></i>
                <span>إضافة صورة ({prodDraftImages.length}/5)</span>
              </label>
            )}
          </div>

          <input
            type="file"
            id="prodImgUploadInp"
            accept="image/*"
            multiple
            hidden
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              const slotsLeft = 5 - prodDraftImages.length;
              if (slotsLeft <= 0) return;
              const toProcess = files.slice(0, slotsLeft);
              showToast('جارٍ ضغط الصور بدقة 900px...');
              const results: string[] = [];
              for (const file of toProcess) {
                try {
                  const b64 = await compressImage(file, 900, 0.7);
                  results.push(b64);
                } catch {
                  showToast(`تعذر ضغط الصورة ${file.name}`, 'err');
                }
              }
              setProdDraftImages((prev) => [...prev, ...results]);
              e.target.value = '';
            }}
          />

          <div style={{ height: '14px' }}></div>

          <div className="two">
            <div>
              <label className="lbl">اسم المنتج *</label>
              <input
                className="inp"
                name="name"
                required
                defaultValue={editingProd?.name || ''}
                placeholder="مثال: بدلة كلاسيكية كحلي"
              />
            </div>
            <div>
              <label className="lbl">السعر ({settings.currency}) *</label>
              <input
                className="inp"
                name="price"
                type="number"
                min="0"
                required
                defaultValue={editingProd?.price || ''}
                placeholder="150000"
              />
            </div>
          </div>

          <div style={{ height: '10px' }}></div>

          <div className="two">
            <div>
              <label className="lbl">السعر القديم قبل الخصم (اختياري)</label>
              <input
                className="inp"
                name="oldPrice"
                type="number"
                min="0"
                defaultValue={editingProd?.oldPrice || ''}
                placeholder="مثال: 180000"
              />
            </div>
            <div>
              <label className="lbl">شارة المنتج</label>
              <select className="inp" name="badge" defaultValue={editingProd?.badge || ''}>
                <option value="">بدون شارة</option>
                {Object.entries(BADGES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ height: '10px' }}></div>

          <div className="two">
            <div>
              <label className="lbl">القسم *</label>
              <select
                className="inp"
                name="categoryId"
                required
                defaultValue={editingProd?.categoryId || (categories[0]?.id || '')}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="lbl">اللون</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="inp"
                  name="color"
                  defaultValue={editingProd?.color || ''}
                  placeholder="أزرق، أسود، بيج..."
                />
                <input
                  type="color"
                  name="colorHex"
                  defaultValue={editingProd?.colorHex || '#233462'}
                  style={{
                    width: '52px',
                    height: '46px',
                    borderRadius: '12px',
                    border: '1.5px solid var(--inp-border)',
                    background: 'var(--card)',
                    padding: '4px',
                    cursor: 'pointer',
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ height: '10px' }}></div>

          <div>
            <label className="lbl">نوع القماش والخامة</label>
            <input
              className="inp"
              name="fabric"
              defaultValue={editingProd?.fabric || ''}
              placeholder="صوف إيطالي، قطن مصري، كتان فاخر، كشميري..."
            />
          </div>

          <div style={{ height: '14px' }}></div>

          {/* خاصية المقاسات: أزرار اختيار سريعة + خانة كتابة يدوية */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '14px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
              <label className="lbl" style={{ marginBottom: 0, fontSize: '14px', fontWeight: 800 }}>
                <i className="fa-solid fa-ruler-combined" style={{ color: 'var(--gold-l)', marginLeft: '6px' }}></i>
                مقاسات المنتج (حدد بالأزرار أو اكتب يدوياً)
              </label>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-line btn-xs"
                  onClick={() => {
                    const letters = ['S', 'M', 'L', 'XL', '2XL'];
                    setProdDraftSizes((prev) => Array.from(new Set([...prev, ...letters])));
                  }}
                  title="تحديد المقاسات الشائعة"
                >
                  + الأحرف الأساسية (S-2XL)
                </button>
                <button
                  type="button"
                  className="btn btn-line btn-xs"
                  onClick={() => {
                    const numbers = ['38', '40', '42', '44', '46', '48'];
                    setProdDraftSizes((prev) => Array.from(new Set([...prev, ...numbers])));
                  }}
                  title="تحديد الأرقام الشائعة"
                >
                  + الأرقام (38-48)
                </button>
                <button
                  type="button"
                  className="btn btn-line btn-xs"
                  style={{ color: '#ff8a8e' }}
                  onClick={() => {
                    setProdDraftSizes([]);
                    setProdCustomSizes('');
                  }}
                  title="مسح كافة المقاسات المحددة"
                >
                  مسح المقاسات
                </button>
              </div>
            </div>

            {/* 1. أزرار مقاسات الأحرف */}
            <div style={{ marginBottom: '12px' }}>
              <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                مقاسات الأحرف المعتمدة (اضغط لتحديد / إلغاء):
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'].map((sz) => {
                  const isSel = prodDraftSizes.includes(sz);
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => {
                        setProdDraftSizes((prev) =>
                          prev.includes(sz) ? prev.filter((x) => x !== sz) : [...prev, sz]
                        );
                      }}
                      className={`btn btn-sm ${isSel ? 'btn-gold' : 'btn-line'}`}
                      style={{
                        minWidth: '46px',
                        padding: '6px 12px',
                        fontWeight: 800,
                        fontSize: '13px',
                        borderRadius: '8px',
                        borderWidth: isSel ? '2px' : '1px',
                        borderColor: isSel ? 'var(--gold-l)' : 'var(--border)',
                        background: isSel ? 'var(--gold-l)' : 'rgba(255,255,255,0.03)',
                        color: isSel ? '#000' : 'var(--text)',
                      }}
                    >
                      {isSel && <i className="fa-solid fa-check" style={{ marginLeft: '4px', fontSize: '10px' }}></i>}
                      {sz}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. أزرار مقاسات الأرقام */}
            <div style={{ marginBottom: '12px' }}>
              <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                مقاسات الأرقام (أحذية / تفصيل رجالي):
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {['36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56', '58'].map((sz) => {
                  const isSel = prodDraftSizes.includes(sz);
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => {
                        setProdDraftSizes((prev) =>
                          prev.includes(sz) ? prev.filter((x) => x !== sz) : [...prev, sz]
                        );
                      }}
                      className={`btn btn-sm ${isSel ? 'btn-gold' : 'btn-line'}`}
                      style={{
                        minWidth: '44px',
                        padding: '6px 10px',
                        fontWeight: 800,
                        fontSize: '12.5px',
                        borderRadius: '8px',
                        borderWidth: isSel ? '2px' : '1px',
                        borderColor: isSel ? 'var(--gold-l)' : 'var(--border)',
                        background: isSel ? 'var(--gold-l)' : 'rgba(255,255,255,0.03)',
                        color: isSel ? '#000' : 'var(--text)',
                      }}
                    >
                      {isSel && <i className="fa-solid fa-check" style={{ marginLeft: '4px', fontSize: '10px' }}></i>}
                      {sz}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. خيارات إضافية للمقاس */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {['مقاس حر (Free Size)', 'تفصيل حسب الطلب', 'جميع المقاسات'].map((sz) => {
                  const isSel = prodDraftSizes.includes(sz);
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => {
                        setProdDraftSizes((prev) =>
                          prev.includes(sz) ? prev.filter((x) => x !== sz) : [...prev, sz]
                        );
                      }}
                      className={`btn btn-sm ${isSel ? 'btn-gold' : 'btn-line'}`}
                      style={{
                        padding: '6px 14px',
                        fontWeight: 700,
                        fontSize: '12px',
                        borderRadius: '8px',
                        borderWidth: isSel ? '2px' : '1px',
                        borderColor: isSel ? 'var(--gold-l)' : 'var(--border)',
                        background: isSel ? 'var(--gold-l)' : 'rgba(255,255,255,0.03)',
                        color: isSel ? '#000' : 'var(--text)',
                      }}
                    >
                      {isSel && <i className="fa-solid fa-check" style={{ marginLeft: '4px', fontSize: '10px' }}></i>}
                      {sz}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. خانة كتابة مقاسات مخصصة يدوياً */}
            <div>
              <label className="lbl" style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                كتابة مقاسات أخرى يدوياً (مفصولة بفاصلة):
              </label>
              <input
                className="inp"
                value={prodCustomSizes}
                onChange={(e) => setProdCustomSizes(e.target.value)}
                placeholder="مثال: مقاس خاص، 60، 62، للأطفال..."
              />
            </div>

            {/* 5. المعاينة المباشرة للمقاسات المختارة التي ستظهر للعملاء */}
            {(() => {
              const cp = prodCustomSizes
                .split(/[,،\n]/)
                .map((x) => x.trim())
                .filter(Boolean);
              const combined = Array.from(new Set([...prodDraftSizes, ...cp]));
              if (combined.length === 0) return null;
              return (
                <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(212, 175, 55, 0.08)', borderRadius: '10px', border: '1px dashed rgba(212, 175, 55, 0.35)' }}>
                  <span style={{ fontSize: '11.5px', color: 'var(--gold-l)', fontWeight: 800, display: 'block', marginBottom: '6px' }}>
                    المقاسات التي سيتم حفظها للمنتج ({combined.length}):
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {combined.map((s) => (
                      <span
                        key={s}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: 'var(--card)',
                          border: '1px solid var(--gold-l)',
                          color: 'var(--gold-l)',
                          padding: '3px 10px',
                          borderRadius: '20px',
                          fontSize: '12px',
                          fontWeight: 700,
                        }}
                      >
                        {s}
                        <button
                          type="button"
                          onClick={() => {
                            if (prodDraftSizes.includes(s)) {
                              setProdDraftSizes((prev) => prev.filter((x) => x !== s));
                            } else {
                              const remaining = prodCustomSizes
                                .split(/[,،\n]/)
                                .map((x) => x.trim())
                                .filter((x) => x && x !== s);
                              setProdCustomSizes(remaining.join('، '));
                            }
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ff8a8e',
                            cursor: 'pointer',
                            fontSize: '12px',
                            padding: 0,
                            lineHeight: 1,
                            fontWeight: 900,
                          }}
                          title="حذف هذا المقاس"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          <div style={{ height: '10px' }}></div>

          <label className="lbl">وصف مختصر</label>
          <textarea
            className="inp"
            name="description"
            defaultValue={editingProd?.description || ''}
            placeholder="وصف تسويقي يبرز جودة وأناقة التصميم..."
          ></textarea>

          <div style={{ height: '10px' }}></div>

          <label className="lbl">تفاصيل الخياطة والمقاسات</label>
          <textarea
            className="inp"
            name="details"
            defaultValue={editingProd?.details || ''}
            placeholder="تفاصيل دقيقة عن نوع الخياطة، البطانة الداخلية، أخذ المقاسات..."
          ></textarea>

          <div style={{ height: '14px' }}></div>

          <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="sw-wrap">
              <input type="checkbox" name="published" defaultChecked={editingProd ? editingProd.published : true} />
              <span className="sw"></span>
              <span className="sw-lb">منشور في المتجر</span>
            </label>
            <label className="sw-wrap">
              <input type="checkbox" name="stock" defaultChecked={editingProd ? editingProd.stock : true} />
              <span className="sw"></span>
              <span className="sw-lb">متوفر للطلب</span>
            </label>
            <label className="sw-wrap">
              <input type="checkbox" name="featured" defaultChecked={editingProd?.featured || false} />
              <span className="sw"></span>
              <span className="sw-lb">مميز بالصفحة الرئيسية</span>
            </label>
          </div>

          <div style={{ height: '20px' }}></div>

          <div className="mdl-acts">
            {!isNew && editingProd && (
              <button
                type="button"
                className="btn btn-danger"
                style={{ marginInlineEnd: 'auto' }}
                onClick={() => {
                  setModalConfirm({
                    title: 'حذف المنتج',
                    msg: `هل أنت متأكد من حذف المنتج (${editingProd.name}) نهائياً؟`,
                    onConfirm: async () => {
                      try {
                        setProducts((prev) => prev.filter((item) => item.id !== editingProd.id));
                        await deleteProduct(editingProd.id);
                        showToast('تم حذف المنتج بنجاح');
                        navigate('#/admin/products');
                      } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : 'فشل حذف المنتج من قاعدة البيانات';
                        showToast(`تعذر حذف المنتج: ${errMsg}`, 'err');
                      }
                    },
                  });
                }}
              >
                <i className="fa-solid fa-trash"></i> حذف المنتج
              </button>
            )}
            <button
              type="button"
              className="btn btn-line"
              onClick={() => navigate('#/admin/products')}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-gold" id="btnSubmitProduct">
              <i className="fa-solid fa-cloud-arrow-up"></i> حفظ في قاعدة البيانات
            </button>
          </div>
        </form>
      </div>
    );
  };

  // Admin Categories
  const renderAdminCategories = () => (
    <>
      <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
        <h4 className="adm-h4">
          <i className="fa-solid fa-plus"></i> إضافة قسم جديد
        </h4>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            const name = String(data.get('name') || '').trim();
            if (!name) return;
            const newCat: Category = {
              id: uid('c'),
              name,
              image: newCatImg,
              order: categories.length,
            };
            await saveCategory(newCat);
            showToast('تمت إضافة القسم بنجاح');
            form.reset();
            setNewCatImg('');
          }}
        >
          <div className="two">
            <div>
              <label className="lbl">اسم القسم *</label>
              <input className="inp" name="name" required placeholder="مثال: بدلات رسمية، ثياب يمنية..." />
            </div>
            <div>
              <label className="lbl">صورة القسم</label>
              <label className="btn btn-line btn-sm" htmlFor="catImgFile" style={{ width: '100%', cursor: 'pointer' }}>
                <i className="fa-solid fa-image"></i> رفع صورة مضغوطة
              </label>
              <input
                type="file"
                id="catImgFile"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const b64 = await compressImage(file, 600, 0.7);
                  setNewCatImg(b64);
                }}
              />
            </div>
          </div>
          {newCatImg ? (
            <img
              src={newCatImg}
              style={{ width: '70px', height: '70px', objectFit: 'cover', borderRadius: '12px', marginTop: '10px' }}
              alt="معاينة"
            />
          ) : null}
          <button type="submit" className="btn btn-gold btn-sm" style={{ marginTop: '14px' }}>
            <i className="fa-solid fa-plus"></i> حفظ القسم
          </button>
        </form>
      </div>

      <div className="sec-h" style={{ marginTop: 0 }}>
        <h3>
          <i className="fa-solid fa-layer-group"></i> الأقسام المسجلة ({categories.length})
        </h3>
      </div>

      {categories.map((c, i) => {
        const prodsCount = products.filter((p) => p.categoryId === c.id).length;
        return (
          <div className="m-row" key={c.id}>
            <img className="m-img" src={c.image || PLACEHOLDER_IMG} alt="" />
            <div className="m-inf">
              <b>{c.name}</b>
              <span>{prodsCount} منتج مرتبط</span>
            </div>
            <div className="m-acts">
              <button
                className="ib"
                onClick={() => setEditingCat(c)}
                title="تعديل"
              >
                <i className="fa-solid fa-pen"></i>
              </button>
              <button
                className="ib danger"
                title="حذف"
                onClick={() => {
                  setModalConfirm({
                    title: 'حذف القسم',
                    msg: `هل أنت متأكد من حذف قسم (${c.name})؟`,
                    onConfirm: async () => {
                      try {
                        setCategories((prev) => prev.filter((item) => item.id !== c.id));
                        await deleteCategory(c.id);
                        showToast('تم حذف القسم بنجاح');
                      } catch (err: unknown) {
                        console.error('Error deleting category:', err);
                        const errMsg = err instanceof Error ? err.message : 'فشل حذف القسم';
                        showToast(`تعذر حذف القسم: ${errMsg}`, 'err');
                      }
                    },
                  });
                }}
              >
                <i className="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        );
      })}
    </>
  );

  // Admin Ads
  const renderAdminAds = () => {
    const getAdLinkDescription = (ad: Ad) => {
      if (!ad.linkType || ad.linkType === 'none' || !ad.linkValue) {
        return 'إعلان للعرض فقط (بدون توجيه)';
      }
      if (ad.linkType === 'cat') {
        const cat = categories.find((c) => c.id === ad.linkValue);
        return `يوجه إلى قسم: «${cat ? cat.name : 'قسم محدد'}»`;
      }
      if (ad.linkType === 'prod') {
        const prod = products.find((p) => p.id === ad.linkValue);
        return `يوجه إلى منتج: «${prod ? prod.name : 'منتج محدد'}»`;
      }
      if (ad.linkType === 'url') {
        return `رابط خارجي: ${ad.linkValue}`;
      }
      return ad.linkValue;
    };

    const getAdKindLabel = (kind: string) => {
      if (kind === 'gold') return 'ذهبي ملكي';
      if (kind === 'green') return 'أخضر واتساب';
      if (kind === 'dark') return 'داكن أنيق';
      return kind;
    };

    return (
      <>
        <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
          <h4 className="adm-h4">
            <i className="fa-solid fa-bullhorn"></i> إضافة إعلان / بانر علوي
          </h4>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              const text = String(data.get('text') || '').trim();
              if (!text) return;

              let finalLinkVal = '';
              if (newAdLinkType === 'cat' || newAdLinkType === 'prod' || newAdLinkType === 'url') {
                finalLinkVal = newAdLinkVal.trim();
                if (!finalLinkVal) {
                  showToast('يرجى تحديد وجهة الرابط (القسم أو المنتج أو الرابط الخارجي)');
                  return;
                }
              }

              const newAd: Ad = {
                id: uid('ad'),
                text,
                icon: String(data.get('icon') || 'fa-bullhorn'),
                kind: (data.get('kind') as 'gold' | 'green' | 'dark') || 'gold',
                linkType: newAdLinkType,
                linkValue: finalLinkVal,
                active: data.get('active') === 'on',
              };
              await saveAd(newAd);
              showToast('تمت إضافة الإعلان بنجاح');
              form.reset();
              setNewAdLinkType('none');
              setNewAdLinkVal('');
            }}
          >
            <label className="lbl">نص الإعلان أو العرض *</label>
            <input
              className="inp"
              name="text"
              required
              placeholder="مثال: عروض خاصة بمناسبة الموسم — تفصيل مميز وأسعار منافسة"
            />
            <div style={{ height: '12px' }}></div>
            <div className="two">
              <div>
                <label className="lbl">رمز وأيقونة الإعلان</label>
                <select className="inp" name="icon" defaultValue="fa-fire">
                  {AD_ICONS.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="lbl">النمط اللوني للشريط</label>
                <select className="inp" name="kind" defaultValue="gold">
                  <option value="gold">ذهبي فاخر (تطريز وملكي)</option>
                  <option value="green">أخضر واتساب (خدمات وتواصل)</option>
                  <option value="dark">داكن أنيق (فخامة هادئة)</option>
                </select>
              </div>
            </div>
            <div style={{ height: '12px' }}></div>
            <div>
              <label className="lbl">ماذا يحدث عند نقر الزبون على الإعلان؟</label>
              <select
                className="inp"
                value={newAdLinkType}
                onChange={(e) => {
                  const val = e.target.value as 'none' | 'cat' | 'prod' | 'url';
                  setNewAdLinkType(val);
                  setNewAdLinkVal('');
                }}
              >
                <option value="none">🔒 بدون رابط — للعرض والقراءة فقط (لا يفتح شيئاً)</option>
                <option value="cat">📂 فتح قسم محدد في المتجر (اختر القسم أدناه)</option>
                <option value="prod">🏷️ فتح صفحة منتج محدد (اختر المنتج أدناه)</option>
                <option value="url">🌐 فتح رابط خارجي (موقعك أو حسابك في إنستغرام/تيك توك)</option>
              </select>
            </div>

            {/* الحقل التفاعلي الذكي حسب الاختيار */}
            <div style={{ marginTop: '10px' }}>
              {newAdLinkType === 'none' && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px dashed rgba(255,255,255,0.12)',
                    fontSize: '12.5px',
                    color: 'var(--mut)',
                  }}
                >
                  <i className="fa-solid fa-circle-info" style={{ color: 'var(--gold)', marginInlineEnd: '6px' }}></i>
                  سيكون هذا الإعلان للعرض الإخباري فقط في أعلى الموقع ولن يقوم بأي توجيه عند النقر.
                </div>
              )}

              {newAdLinkType === 'cat' && (
                <div>
                  <label className="lbl">اختر القسم الذي تريد توجيه الزبون إليه *</label>
                  <select
                    className="inp"
                    value={newAdLinkVal}
                    onChange={(e) => setNewAdLinkVal(e.target.value)}
                    required
                  >
                    <option value="">-- اضغط هنا لاختيار القسم من قائمتك --</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        📂 {c.name}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: '11.5px', color: 'var(--mut)', marginTop: '4px', display: 'block' }}>
                    تتحدث هذه القائمة تلقائياً عند إضافة أي قسم جديد في المتجر.
                  </span>
                </div>
              )}

              {newAdLinkType === 'prod' && (
                <div>
                  <label className="lbl">اختر المنتج الذي تريد فتح صفحته للزبون *</label>
                  <select
                    className="inp"
                    value={newAdLinkVal}
                    onChange={(e) => setNewAdLinkVal(e.target.value)}
                    required
                  >
                    <option value="">-- اضغط هنا لاختيار المنتج من متجرك --</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        🏷️ {p.name} ({p.price.toLocaleString()} ر.ي)
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: '11.5px', color: 'var(--mut)', marginTop: '4px', display: 'block' }}>
                    ستفتح صفحة المنتج وتفاصيله وصوره تلقائياً للزبون بمجرد نقر الإعلان.
                  </span>
                </div>
              )}

              {newAdLinkType === 'url' && (
                <div>
                  <label className="lbl">الرابط الخارجي الكامل *</label>
                  <input
                    className="inp"
                    type="url"
                    dir="ltr"
                    placeholder="https://instagram.com/your_account"
                    value={newAdLinkVal}
                    onChange={(e) => setNewAdLinkVal(e.target.value)}
                    required
                  />
                  <span style={{ fontSize: '11.5px', color: 'var(--mut)', marginTop: '4px', display: 'block' }}>
                    الصق رابط صفحة إنستغرام أو الموقع أو العرض الخارجي الذي تريده.
                  </span>
                </div>
              )}
            </div>

            <div style={{ height: '14px' }}></div>
            <label className="sw-wrap">
              <input type="checkbox" name="active" defaultChecked />
              <span className="sw"></span>
              <span className="sw-lb">تفعيل وعرض الإعلان فوراً في أعلى المتجر</span>
            </label>
            <div style={{ height: '14px' }}></div>
            <button type="submit" className="btn btn-gold btn-sm">
              <i className="fa-solid fa-plus"></i> حفظ الإعلان
            </button>
          </form>
        </div>

        <div className="sec-h" style={{ marginTop: 0 }}>
          <h3>
            <i className="fa-solid fa-rectangle-ad"></i> الإعلانات والبانرات الحالية ({ads.length})
          </h3>
        </div>

        {ads.length === 0 ? (
          <div className="empty" style={{ padding: '24px' }}>
            <i className="fa-solid fa-bullhorn"></i>
            <b>لا توجد إعلانات مسجلة حالياً</b>
            <span>أضف إعلاناتك من النموذج أعلاه لتظهر في الشريط العلوي للمتجر.</span>
          </div>
        ) : (
          ads.map((ad) => {
            const linkDesc = getAdLinkDescription(ad);
            const kindLabel = getAdKindLabel(ad.kind || 'gold');
            return (
              <div className="m-row" key={ad.id} style={{ alignItems: 'flex-start' }}>
                <div
                  className="s-ic"
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px',
                    background:
                      ad.kind === 'green'
                        ? 'rgba(37, 211, 102, 0.15)'
                        : ad.kind === 'dark'
                        ? 'rgba(255, 255, 255, 0.08)'
                        : 'rgba(197, 160, 89, 0.15)',
                    color:
                      ad.kind === 'green'
                        ? '#25d366'
                        : ad.kind === 'dark'
                        ? '#e5e5e5'
                        : 'var(--gold-l)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <i className={`fa-solid ${ad.icon || 'fa-bullhorn'}`}></i>
                </div>
                <div className="m-inf" style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: '14px', lineHeight: '1.4' }}>{ad.text}</b>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '8px',
                      alignItems: 'center',
                      marginTop: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '6px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'var(--txt)',
                      }}
                    >
                      النمط: {kindLabel}
                    </span>
                    <span style={{ color: 'var(--gold-l)' }}>
                      <i className="fa-solid fa-link" style={{ marginInlineEnd: '4px', opacity: 0.8 }}></i>
                      {linkDesc}
                    </span>
                  </div>
                </div>
                <label className="sw-wrap" title="تفعيل/إيقاف" style={{ marginInline: '6px' }}>
                  <input
                    type="checkbox"
                    checked={ad.active}
                    onChange={async (e) => {
                      await saveAd({ ...ad, active: e.target.checked });
                      showToast(e.target.checked ? 'تم تفعيل الإعلان' : 'تم إيقاف الإعلان');
                    }}
                  />
                  <span className="sw"></span>
                </label>
                <div className="m-acts">
                  <button
                    className="ib"
                    onClick={() => {
                      setEditingAd(ad);
                      setEditAdLinkType(ad.linkType || 'none');
                      setEditAdLinkVal(ad.linkValue || '');
                    }}
                    title="تعديل الإعلان"
                  >
                    <i className="fa-solid fa-pen"></i>
                  </button>
                  <button
                    className="ib danger"
                    onClick={() => {
                      setModalConfirm({
                        title: 'حذف الإعلان',
                        msg: 'هل أنت متأكد من حذف هذا الإعلان؟',
                        onConfirm: async () => {
                          try {
                            setAds((prev) => prev.filter((item) => item.id !== ad.id));
                            await deleteAd(ad.id);
                            showToast('تم حذف الإعلان');
                          } catch (err: unknown) {
                            console.error('Error deleting ad:', err);
                            const errMsg = err instanceof Error ? err.message : 'فشل حذف الإعلان';
                            showToast(`تعذر حذف الإعلان: ${errMsg}`, 'err');
                          }
                        },
                      });
                    }}
                    title="حذف"
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </>
    );
  };

  // Admin Testimonials
  const renderAdminTestimonials = () => (
    <>
      <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
        <h4 className="adm-h4">
          <i className="fa-solid fa-star"></i> إضافة رأي عميل
        </h4>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            const name = String(data.get('name') || '').trim();
            const text = String(data.get('text') || '').trim();
            if (!name || !text) return;
            const newT: Testimonial = {
              id: uid('t'),
              name,
              stars: Number(data.get('stars')) || 5,
              text,
            };
            await saveTestimonial(newT);
            showToast('تمت إضافة رأي العميل بنجاح');
            form.reset();
          }}
        >
          <div className="two">
            <div>
              <label className="lbl">اسم العميل *</label>
              <input className="inp" name="name" required placeholder="مثال: أحمد عبد الله" />
            </div>
            <div>
              <label className="lbl">التقييم</label>
              <select className="inp" name="stars" defaultValue="5">
                {[5, 4, 3, 2, 1].map((s) => (
                  <option key={s} value={s}>
                    {s} نجوم
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ height: '10px' }}></div>
          <label className="lbl">نص التقييم *</label>
          <textarea className="inp" name="text" required placeholder="ماذا قال العميل عن الخياطة والتفصيل؟"></textarea>
          <div style={{ height: '12px' }}></div>
          <button type="submit" className="btn btn-gold btn-sm">
            <i className="fa-solid fa-plus"></i> حفظ الرأي
          </button>
        </form>
      </div>

      <div className="sec-h" style={{ marginTop: 0 }}>
        <h3>
          <i className="fa-solid fa-comments"></i> آراء العملاء ({testimonials.length})
        </h3>
      </div>

      {testimonials.map((t) => (
        <div className="m-row" key={t.id}>
          <div className="s-ic" style={{ width: '42px', height: '42px' }}>
            <i className="fa-solid fa-quote-right"></i>
          </div>
          <div className="m-inf">
            <b>
              {t.name} — {'★'.repeat(t.stars)}
            </b>
            <span>"{t.text}"</span>
          </div>
          <div className="m-acts">
            <button className="ib" onClick={() => setEditingTesti(t)} title="تعديل">
              <i className="fa-solid fa-pen"></i>
            </button>
            <button
              className="ib danger"
              onClick={() => {
                setModalConfirm({
                  title: 'حذف الرأي',
                  msg: 'هل أنت متأكد من حذف هذا الرأي؟',
                  onConfirm: async () => {
                    try {
                      setTestimonials((prev) => prev.filter((item) => item.id !== t.id));
                      await deleteTestimonial(t.id);
                      showToast('تم حذف الرأي بنجاح');
                    } catch (err: unknown) {
                      console.error('Error deleting testimonial:', err);
                      const errMsg = err instanceof Error ? err.message : 'فشل حذف الرأي';
                      showToast(`تعذر حذف الرأي: ${errMsg}`, 'err');
                    }
                  },
                });
              }}
              title="حذف"
            >
              <i className="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      ))}
    </>
  );

  // Admin Settings & Backup
  const renderAdminSettings = () => (
    <>
      <form
        className="card"
        style={{ padding: '20px' }}
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);

          const newSettings: StoreSettings = {
            shopName: String(data.get('shopName') || ''),
            shopNameEn: String(data.get('shopNameEn') || ''),
            shopSub: String(data.get('shopSub') || ''),
            tagline: String(data.get('tagline') || ''),
            logoUrl: String(data.get('logoUrl') || ''),
            whatsapp: String(data.get('whatsapp') || '201503256581'),
            currency: String(data.get('currency') || 'ريال'),
            waTemplate: String(data.get('waTemplate') || ''),
            waGeneral: String(data.get('waGeneral') || ''),
            showFloatWa: data.get('showFloatWa') === 'on',
            hoursOpen: String(data.get('hoursOpen') || '09:00'),
            hoursClose: String(data.get('hoursClose') || '22:00'),
            address: String(data.get('address') || ''),
            mapUrl: String(data.get('mapUrl') || ''),
            socFb: String(data.get('socFb') || ''),
            socIg: String(data.get('socIg') || ''),
            socTt: String(data.get('socTt') || ''),
            socTw: String(data.get('socTw') || ''),
            aboutText: String(data.get('aboutText') || ''),
            homeShow: {
              promo: data.get('hs_promo') === 'on',
              cats: data.get('hs_cats') === 'on',
              latest: data.get('hs_latest') === 'on',
              sale: data.get('hs_sale') === 'on',
              feat: data.get('hs_feat') === 'on',
              testi: data.get('hs_testi') === 'on',
              about: data.get('hs_about') === 'on',
            },
            adminUsername: settings.adminUsername || 'admin',
            adminEmail: settings.adminEmail || 'admin@store.internal',
          };

          await saveStoreSettings(newSettings);
          showToast('تم حفظ الإعدادات في Firestore بنجاح');
        }}
      >
        <h4 className="adm-h4">
          <i className="fa-solid fa-store"></i> هوية المحل والمتجر
        </h4>

        <div className="two">
          <div>
            <label className="lbl">اسم المحل</label>
            <input className="inp" name="shopName" defaultValue={settings.shopName} />
          </div>
          <div>
            <label className="lbl">الاسم بالإنجليزية</label>
            <input className="inp" name="shopNameEn" defaultValue={settings.shopNameEn} />
          </div>
        </div>

        <div style={{ height: '10px' }}></div>

        <div className="two">
          <div>
            <label className="lbl">العنوان الفرعي</label>
            <input className="inp" name="shopSub" defaultValue={settings.shopSub} />
          </div>
          <div>
            <label className="lbl">الشعار النصي (Slogan)</label>
            <input className="inp" name="tagline" defaultValue={settings.tagline} />
          </div>
        </div>

        <div style={{ height: '10px' }}></div>

        <label className="lbl">رابط الشعار</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input className="inp" name="logoUrl" defaultValue={settings.logoUrl} id="settingsLogoUrl" />
        </div>
        <img
          src={settings.logoUrl || DEFAULT_SETTINGS.logoUrl}
          style={{ width: '60px', height: '60px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--gold)', marginTop: '8px' }}
          alt="الشعار"
        />

        <div style={{ height: '16px' }}></div>

        <h4 className="adm-h4">
          <i className="fa-brands fa-whatsapp"></i> واتساب واستقبال الطلبات
        </h4>

        <div className="two">
          <div>
            <label className="lbl">رقم واتساب صاحب المحل (بدون + أو مسافات)</label>
            <input
              className="inp"
              name="whatsapp"
              defaultValue={settings.whatsapp}
              placeholder="201503256581"
            />
            <span className="hint">محدد حالياً برقم صاحب المحل: +20 15 03256581</span>
          </div>
          <div>
            <label className="lbl">العملة</label>
            <input className="inp" name="currency" defaultValue={settings.currency} />
          </div>
        </div>

        <div style={{ height: '10px' }}></div>

        <label className="lbl">قالب رسالة طلب المنتج</label>
        <textarea
          className="inp"
          name="waTemplate"
          defaultValue={settings.waTemplate}
        ></textarea>

        <div style={{ height: '10px' }}></div>

        <label className="lbl">قالب رسالة الاستفسار العامة</label>
        <textarea
          className="inp"
          name="waGeneral"
          defaultValue={settings.waGeneral}
          style={{ minHeight: '70px' }}
        ></textarea>

        <div style={{ height: '12px' }}></div>

        <label className="sw-wrap">
          <input type="checkbox" name="showFloatWa" defaultChecked={settings.showFloatWa} />
          <span className="sw"></span>
          <span className="sw-lb">إظهار زر واتساب العائم في كل الصفحات</span>
        </label>

        <div style={{ height: '16px' }}></div>

        <h4 className="adm-h4">
          <i className="fa-solid fa-location-dot"></i> أوقات العمل والعنوان
        </h4>

        <div className="two" style={{ gap: '12px' }}>
          <Time12Picker
            label="ساعة الافتتاح"
            name="hoursOpen"
            defaultValue={settings.hoursOpen || '09:00'}
            icon="fa-clock"
          />
          <Time12Picker
            label="ساعة الإغلاق"
            name="hoursClose"
            defaultValue={settings.hoursClose || '22:00'}
            icon="fa-moon"
          />
        </div>

        <div style={{ height: '10px' }}></div>

        <label className="lbl">العنوان الجغرافي</label>
        <input className="inp" name="address" defaultValue={settings.address} />

        <div style={{ height: '10px' }}></div>

        <label className="lbl">رابط الخريطة (Google Maps)</label>
        <input className="inp" name="mapUrl" defaultValue={settings.mapUrl} placeholder="https://maps.google.com/..." />

        <div style={{ height: '10px' }}></div>

        <div className="two">
          <div>
            <label className="lbl">رابط فيسبوك</label>
            <input className="inp" name="socFb" defaultValue={settings.socFb} />
          </div>
          <div>
            <label className="lbl">رابط إنستغرام</label>
            <input className="inp" name="socIg" defaultValue={settings.socIg} />
          </div>
        </div>

        <div style={{ height: '10px' }}></div>

        <div className="two">
          <div>
            <label className="lbl">رابط تيك توك</label>
            <input className="inp" name="socTt" defaultValue={settings.socTt} />
          </div>
          <div>
            <label className="lbl">رابط منصة إكس (تويتر)</label>
            <input className="inp" name="socTw" defaultValue={settings.socTw} />
          </div>
        </div>

        <div style={{ height: '10px' }}></div>

        <label className="lbl">نبذة "عن المحل"</label>
        <textarea className="inp" name="aboutText" defaultValue={settings.aboutText}></textarea>

        <div style={{ height: '16px' }}></div>

        <h4 className="adm-h4">
          <i className="fa-solid fa-eye"></i> إظهار/إخفاء أقسام الصفحة الرئيسية
        </h4>

        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          <label className="sw-wrap">
            <input type="checkbox" name="hs_cats" defaultChecked={settings.homeShow.cats !== false} />
            <span className="sw"></span>
            <span className="sw-lb">الأقسام</span>
          </label>
          <label className="sw-wrap">
            <input type="checkbox" name="hs_latest" defaultChecked={settings.homeShow.latest !== false} />
            <span className="sw"></span>
            <span className="sw-lb">أحدث المنتجات</span>
          </label>
          <label className="sw-wrap">
            <input type="checkbox" name="hs_sale" defaultChecked={settings.homeShow.sale !== false} />
            <span className="sw"></span>
            <span className="sw-lb">العروض</span>
          </label>
          <label className="sw-wrap">
            <input type="checkbox" name="hs_feat" defaultChecked={settings.homeShow.feat !== false} />
            <span className="sw"></span>
            <span className="sw-lb">التصاميم المميزة</span>
          </label>
          <label className="sw-wrap">
            <input type="checkbox" name="hs_testi" defaultChecked={settings.homeShow.testi !== false} />
            <span className="sw"></span>
            <span className="sw-lb">آراء العملاء</span>
          </label>
          <label className="sw-wrap">
            <input type="checkbox" name="hs_about" defaultChecked={settings.homeShow.about !== false} />
            <span className="sw"></span>
            <span className="sw-lb">عن المحل</span>
          </label>
        </div>

        <div style={{ height: '20px' }}></div>

        <button type="submit" className="btn btn-gold" id="btnSaveStoreSettings">
          <i className="fa-solid fa-floppy-disk"></i> حفظ الإعدادات في Firestore
        </button>
      </form>

      {/* Backup & Restore Card */}
      <div className="card" style={{ padding: '20px', marginTop: '16px' }} id="backupSection">
        <h4 className="adm-h4">
          <i className="fa-solid fa-database"></i> النسخ الاحتياطي لقاعدة البيانات
        </h4>
        <p className="hint" style={{ marginBottom: '14px' }}>
          يمكنك تنزيل نسخة احتياطية كاملة من كل المنتجات والأقسام والإعلانات والآراء بصيغة JSON، أو استعادتها في أي وقت.
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-line btn-sm"
            onClick={async () => {
              showToast('جارٍ تصدير النسخة الاحتياطية من Firestore...');
              try {
                const data = await exportFullBackup();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `brand-yemen-backup-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
                showToast('تم تصدير النسخة الاحتياطية بنجاح');
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'فشل تصدير النسخة الاحتياطية';
                showToast(message, 'err');
              }
            }}
            id="btnExportBackup"
          >
            <i className="fa-solid fa-download"></i> تصدير البيانات (JSON)
          </button>

          <button
            type="button"
            className="btn btn-gold btn-sm"
            id="btnSeedDemoData"
            onClick={() => {
              setModalConfirm({
                title: 'تثبيت البيانات التجريبية في Firestore',
                msg: 'سيتم حفظ وتحديث كافة المنتجات والأقسام والإعلانات والآراء التجريبية بصور عالية الجودة في قاعدة بيانات Firestore الخاصة بك. هل تريد المتابعة؟',
                onConfirm: async () => {
                  showToast('جارٍ حفظ البيانات التجريبية في Firestore...');
                  try {
                    await importFullBackup({
                      categories: DEMO_CATEGORIES,
                      products: DEMO_PRODUCTS,
                      ads: DEMO_ADS,
                      testimonials: DEMO_TESTIMONIALS,
                      settings: DEFAULT_SETTINGS,
                    });
                    showToast('تم حفظ البيانات التجريبية في Firestore بنجاح!', 'ok');
                  } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : 'فشل حفظ البيانات التجريبية';
                    showToast(message, 'err');
                  }
                },
              });
            }}
          >
            <i className="fa-solid fa-wand-magic-sparkles"></i> تثبيت البيانات التجريبية في Firestore
          </button>

          <label className="btn btn-line btn-sm" htmlFor="importBackupInput" style={{ cursor: 'pointer' }}>
            <i className="fa-solid fa-upload"></i> استيراد نسخة احتياطية
          </label>
          <input
            type="file"
            id="importBackupInput"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = async () => {
                try {
                  const json = JSON.parse(reader.result as string);
                  showToast('جارٍ استيراد البيانات وكتابتها في Firestore...');
                  await importFullBackup(json);
                  showToast('تم استيراد البيانات بنجاح في قاعدة البيانات');
                } catch {
                  showToast('ملف النسخة الاحتياطية غير صالح أو حدث خطأ أثناء الاستيراد', 'err');
                }
              };
              reader.readAsText(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </>
  );

  // Admin Security View (إدارة اسم المستخدم وكلمة المرور للمدير وتعديلها)
  const renderAdminSecurity = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '580px' }}>
      {/* بطاقة تعديل اسم المستخدم وكلمة المرور */}
      <div className="card" style={{ padding: '22px' }}>
        <h4 className="adm-h4">
          <i className="fa-solid fa-key" style={{ color: 'var(--gold-l)' }}></i> تعديل بيانات دخول المدير (اسم المستخدم وكلمة المرور)
        </h4>
        <p className="hint" style={{ marginBottom: '16px', lineHeight: '1.6' }}>
          يمكنك كمدير تغيير اسم المستخدم وكلمة المرور الخاصة بلوحة التحكم في أي وقت. يتم التشفير والحفظ فورياً في قاعدة بيانات Firestore.
        </p>

        <div
          style={{
            background: 'rgba(197, 160, 89, 0.1)',
            border: '1px solid var(--gold-d)',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            fontSize: '13px',
          }}
        >
          <span style={{ color: 'var(--muted)' }}>اسم المستخدم النشط حالياً: </span>
          <strong style={{ color: 'var(--gold-l)', fontSize: '14px' }}>
            {settings.adminUsername || adminSession.username || 'admin'}
          </strong>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const targetUser = secNewUser.trim() || settings.adminUsername || adminSession.username || 'admin';
            const targetPass = secNewPass.trim();

            if (!targetUser || targetUser.length < 3) {
              showToast('يجب أن يتكون اسم المستخدم من 3 أحرف على الأقل', 'err');
              return;
            }
            if (!targetPass || targetPass.length < 6) {
              showToast('يجب أن تتكون كلمة المرور الجديدة من 6 خانات على الأقل', 'err');
              return;
            }
            if (targetPass !== secConfirmPass.trim()) {
              showToast('كلمة المرور وتأكيدها غير متطابقين', 'err');
              return;
            }

            try {
              setSecLoading(true);
              const res = await saveAdminCredentials(targetUser, targetPass);
              if (!res.success) {
                showToast(res.error || 'فشل حفظ وتحديث بيانات الدخول', 'err');
                return;
              }
              setHasCustomCreds(true);
              setLoginUsername(targetUser);
              setLoginPassword('');
              setSettings((prev) => ({
                ...prev,
                adminUsername: targetUser,
                adminEmail: `${targetUser.trim().toLowerCase()}@store.internal`,
              }));
              const updatedSess = { loggedIn: true, username: targetUser };
              setAdminSession(updatedSess);
              try {
                sessionStorage.setItem('by_adm_session', JSON.stringify(updatedSess));
              } catch {}
              setSecCurrentPass('');
              setSecNewUser('');
              setSecNewPass('');
              setSecConfirmPass('');
              showToast('تم تحديث اسم المستخدم وكلمة المرور بنجاح وحفظها بأمان!', 'ok');
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'فشل حفظ بيانات الدخول';
              showToast(msg, 'err');
            } finally {
              setSecLoading(false);
            }
          }}
        >
          <label className="lbl">
            <i className="fa-solid fa-user" style={{ marginLeft: '6px', color: 'var(--gold-l)' }}></i>
            اسم المستخدم الجديد
          </label>
          <input
            className="inp"
            type="text"
            placeholder={settings.adminUsername || adminSession.username || 'admin'}
            value={secNewUser}
            onChange={(e) => setSecNewUser(e.target.value)}
            id="secNewUserInp"
            required
          />

          <div style={{ height: '14px' }}></div>

          <label className="lbl">
            <i className="fa-solid fa-lock" style={{ marginLeft: '6px', color: 'var(--gold-l)' }}></i>
            كلمة المرور الجديدة
          </label>
          <input
            className="inp"
            type="password"
            placeholder="أدخل كلمة المرور الجديدة (6 خانات على الأقل)"
            value={secNewPass}
            onChange={(e) => setSecNewPass(e.target.value)}
            id="secNewPassInp"
            required
          />

          <div style={{ height: '14px' }}></div>

          <label className="lbl">
            <i className="fa-solid fa-lock-open" style={{ marginLeft: '6px', color: 'var(--gold-l)' }}></i>
            تأكيد كلمة المرور الجديدة
          </label>
          <input
            className="inp"
            type="password"
            placeholder="أعد إدخال كلمة المرور للتأكيد"
            value={secConfirmPass}
            onChange={(e) => setSecConfirmPass(e.target.value)}
            id="secConfirmPassInp"
            required
          />

          <div style={{ height: '18px' }}></div>

          <button
            type="submit"
            className="btn btn-gold btn-blk"
            disabled={secLoading}
            id="btnSaveAdminCredentials"
          >
            {secLoading ? (
              <>
                <i className="fa-solid fa-spinner fa-spin"></i> جارٍ الحفظ والتأكيد في Firebase...
              </>
            ) : (
              <>
                <i className="fa-solid fa-floppy-disk"></i> حفظ وتحديث بيانات دخول المدير
              </>
            )}
          </button>
        </form>
      </div>

      {/* بطاقة الحساب الإضافي وحالة النظام */}
      <div className="card" style={{ padding: '20px' }}>
        <h4 className="adm-h4">
          <i className="fa-solid fa-shield-halved"></i> الأمان وقواعد Firestore
        </h4>
        <div className="note-box" style={{ marginBottom: '14px' }}>
          <i className="fa-solid fa-circle-check"></i>
          <strong> الدخول بالاسم وكلمة المرور مُفعّل ومؤمّن</strong>
          <p style={{ marginTop: '6px' }}>
            يمكنك الدخول وإدارة المتجر باسم المستخدم وكلمة المرور الخاصة بك، كما يتوفر خيار الدخول السريع بحساب Google المعتمد للمدير.
          </p>
        </div>

        <div style={{ fontSize: '13px', lineHeight: '1.8', color: 'var(--txt)' }}>
          <p>
            <strong>جلسة المدير الحالية:</strong>{' '}
            <span style={{ color: 'var(--gold-l)', fontWeight: 'bold' }}>
              {adminSession.loggedIn
                ? `مسجل دخول باسم (${adminSession.username})`
                : currentUser
                ? 'مسجل بحساب Google المعتمد'
                : 'غير مسجل'}
            </span>
          </p>
          <p style={{ marginTop: '6px' }}>
            <strong>صلاحية الإدارة:</strong>{' '}
            {isAdmin ? (
              <span className="badge b-ok">مصرح لك بالكامل</span>
            ) : (
              <span className="badge b-no">غير مصرح</span>
            )}
          </p>
        </div>

        <div style={{ marginTop: '20px' }}>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={handleAdminLogout}
            id="btnSecurityLogout"
          >
            <i className="fa-solid fa-right-from-bracket"></i> تسجيل الخروج من لوحة المدير
          </button>
        </div>
      </div>
    </div>
  );

  // ----------------------------------------------------
  // RENDER APP
  // ----------------------------------------------------

  const isCurrentAdminView = route.params[0] === 'admin';

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden relative flex flex-col">
      {/* Header (Only on public view) */}
      {!isCurrentAdminView && renderHeader(route.path !== 'home')}

      {/* Main Pages */}
      {isCurrentAdminView ? (
        authLoading ? (
          <div className="min-h-screen grid place-items-center">
            <div className="logo-ring big animate-pulse">
              <img className="logo-img" src={settings.logoUrl || DEFAULT_SETTINGS.logoUrl} alt="" />
            </div>
          </div>
        ) : !isAdmin ? (
          renderAdminLogin()
        ) : (
          renderAdminDashboard()
        )
      ) : route.path === 'home' ? (
        renderHome()
      ) : route.path === 'categories' ? (
        renderCategoriesView()
      ) : route.path === 'products' || route.path === 'category' ? (
        renderProductsView()
      ) : route.path === 'product' ? (
        renderProductDetails()
      ) : route.path === 'contact' ? (
        renderContactView()
      ) : (
        renderHome()
      )}

      {/* Floating WhatsApp Button */}
      {!isCurrentAdminView && settings.showFloatWa && (
        <button
          className="float-wa"
          onClick={() => openWhatsApp()}
          aria-label="واتساب"
          id="btnFloatingWa"
        >
          <i className="fa-brands fa-whatsapp"></i>
        </button>
      )}

      {/* Mobile Bottom Navigation */}
      {!isCurrentAdminView && (
        <nav className="bnav" id="bnav">
          <button
            className={route.path === 'home' ? 'on' : ''}
            onClick={() => navigate('#/')}
          >
            <i className="fa-solid fa-house"></i>
            <span>الرئيسية</span>
          </button>
          <button
            className={route.path === 'categories' ? 'on' : ''}
            onClick={() => navigate('#/categories')}
          >
            <i className="fa-solid fa-table-cells-large"></i>
            <span>الأقسام</span>
          </button>
          <button
            className={route.path === 'products' || route.path === 'product' ? 'on' : ''}
            onClick={() => navigate('#/products')}
          >
            <i className="fa-solid fa-bag-shopping"></i>
            <span>المنتجات</span>
          </button>
          <button
            className={route.path === 'contact' ? 'on' : ''}
            onClick={() => navigate('#/contact')}
          >
            <i className="fa-brands fa-whatsapp"></i>
            <span>واتساب</span>
          </button>
        </nav>
      )}

      {/* Mobile Drawer Menu */}
      <div
        className={`ov ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      ></div>
      <aside className={`drawer ${drawerOpen ? 'open' : ''}`} id="drawerMenu">
        <div className="dr-h">
          <span className="logo-ring">
            <img className="logo-img" src={settings.logoUrl || DEFAULT_SETTINGS.logoUrl} alt={settings.shopName} />
          </span>
          <div>
            <b>{settings.shopName}</b>
            <small>{settings.shopNameEn}</small>
          </div>
        </div>
        <button className="dr-l" onClick={() => navigate('#/')}>
          <i className="fa-solid fa-house"></i> الرئيسية
        </button>
        <button className="dr-l" onClick={() => navigate('#/categories')}>
          <i className="fa-solid fa-table-cells-large"></i> الأقسام
        </button>
        <button className="dr-l" onClick={() => navigate('#/products')}>
          <i className="fa-solid fa-bag-shopping"></i> كل المنتجات
        </button>
        <button
          className="dr-l"
          onClick={() => {
            setDrawerOpen(false);
            setSearchOpen(true);
          }}
        >
          <i className="fa-solid fa-magnifying-glass"></i> بحث سريع
        </button>
        <button className="dr-l" onClick={() => navigate('#/contact')}>
          <i className="fa-brands fa-whatsapp"></i> تواصل عبر واتساب
        </button>
        <button
          className="dr-l"
          onClick={() => {
            toggleTheme();
          }}
          id="btnDrawerToggleTheme"
        >
          <i className={theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun'}></i>
          <span>{theme === 'light' ? 'الوضع الليلي' : 'الوضع النهاري (Light Mode)'}</span>
        </button>
        <button className="dr-l" onClick={() => navigate('#/admin')}>
          <i className="fa-solid fa-shield-halved"></i> لوحة تحكم المدير
        </button>
        <div className="dr-foot">
          <span>{settings.tagline}</span>
        </div>
      </aside>

      {/* Live Search Modal */}
      <div className={`srch ${searchOpen ? 'open' : ''}`} id="searchModal">
        <div className="srch-top">
          <input
            className="inp"
            placeholder="ابحث عن منتج، قسم، لون، قماش..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus={searchOpen}
            id="globalSearchInp"
          />
          <button className="icon-btn" onClick={() => setSearchOpen(false)} aria-label="إغلاق">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div className="srch-res">
          {searchQuery.trim() === '' ? (
            <div className="empty" style={{ padding: '30px' }}>
              <i className="fa-solid fa-magnifying-glass"></i>
              <b>ابحث في المتجر</b>
              <span>اكتب اسم المنتج أو القسم أو القماش</span>
            </div>
          ) : (
            (() => {
              const q = searchQuery.trim().toLowerCase();
              const matchedCats = categories.filter((c) => c.name.toLowerCase().includes(q));
              const matchedProds = products.filter(
                (p) =>
                  p.published &&
                  (p.name + ' ' + (p.color || '') + ' ' + (p.fabric || '')).toLowerCase().includes(q)
              );

              if (matchedCats.length === 0 && matchedProds.length === 0) {
                return (
                  <div className="empty" style={{ padding: '30px' }}>
                    <i className="fa-solid fa-face-frown"></i>
                    <b>لا توجد نتائج</b>
                    <span>لم نجد ما يطابق بحثك.</span>
                  </div>
                );
              }

              return (
                <>
                  {matchedCats.map((c) => (
                    <div
                      className="s-row"
                      key={c.id}
                      onClick={() => {
                        setSearchOpen(false);
                        navigate(`#/category/${c.id}`);
                      }}
                    >
                      <img src={c.image || PLACEHOLDER_IMG} alt="" />
                      <div>
                        <b>{c.name}</b>
                        <span>قسم</span>
                      </div>
                    </div>
                  ))}
                  {matchedProds.map((p) => (
                    <div
                      className="s-row"
                      key={p.id}
                      onClick={() => {
                        setSearchOpen(false);
                        navigate(`#/product/${p.id}`);
                      }}
                    >
                      <img src={p.images[0] || PLACEHOLDER_IMG} alt="" />
                      <div style={{ flex: 1 }}>
                        <b>{p.name}</b>
                        <span>
                          {fmt(p.price)} {settings.currency}
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              );
            })()
          )}
        </div>
      </div>

      {/* Filter Bottom Sheet */}
      <div
        className={`ov ${filterSheetOpen ? 'open' : ''}`}
        style={{ zIndex: 84 }}
        onClick={() => setFilterSheetOpen(false)}
      ></div>
      <div className={`sheet ${filterSheetOpen ? 'open' : ''}`} id="filterSheet">
        <h4>
          <i className="fa-solid fa-sliders"></i> تصفية المنتجات
        </h4>
        <div className="sh-sec">
          <div className="lbl">الأقسام</div>
          <div className="chips">
            {categories.map((c) => (
              <button
                key={c.id}
                className={`chip ${filCats.includes(c.id) ? 'on' : ''}`}
                onClick={() =>
                  setFilCats((prev) =>
                    prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                  )
                }
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="sh-sec">
          <button
            className={`chip ${filSale ? 'on' : ''}`}
            onClick={() => setFilSale(!filSale)}
          >
            <i className="fa-solid fa-fire"></i> العروض والخصومات فقط
          </button>
        </div>

        <div className="sh-sec">
          <div className="lbl">نطاق السعر ({settings.currency})</div>
          <div className="two">
            <input
              className="inp"
              type="number"
              placeholder="من"
              value={filMin}
              onChange={(e) => setFilMin(e.target.value)}
            />
            <input
              className="inp"
              type="number"
              placeholder="إلى"
              value={filMax}
              onChange={(e) => setFilMax(e.target.value)}
            />
          </div>
        </div>

        <div className="mdl-acts">
          <button
            className="btn btn-line"
            onClick={() => {
              setFilCats([]);
              setFilColors([]);
              setFilSizes([]);
              setFilMin('');
              setFilMax('');
              setFilSale(false);
            }}
          >
            مسح الكل
          </button>
          <button className="btn btn-gold" onClick={() => setFilterSheetOpen(false)}>
            تطبيق
          </button>
        </div>
      </div>

      {/* Sort Sheet */}
      <div
        className={`ov ${sortSheetOpen ? 'open' : ''}`}
        style={{ zIndex: 84 }}
        onClick={() => setSortSheetOpen(false)}
      ></div>
      <div className={`sheet ${sortSheetOpen ? 'open' : ''}`} id="sortSheet">
        <h4>
          <i className="fa-solid fa-arrow-down-wide-short"></i> ترتيب المنتجات
        </h4>
        <div className="chips">
          {Object.entries(SORTS).map(([k, v]) => (
            <button
              key={k}
              className={`chip ${filSort === k ? 'on' : ''}`}
              onClick={() => {
                setFilSort(k);
                setSortSheetOpen(false);
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      <div className={`lb ${lightbox.open ? 'open' : ''}`} id="lightbox">
        <div className="lb-top">
          <span>
            {lightbox.index + 1} / {lightbox.images.length}
          </span>
          <button
            className="icon-btn"
            onClick={() => setLightbox((prev) => ({ ...prev, open: false }))}
            aria-label="إغلاق"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div className="lb-img">
          {lightbox.images.length > 1 && (
            <button
              className="lb-nav prev"
              onClick={() =>
                setLightbox((prev) => ({
                  ...prev,
                  index: (prev.index - 1 + prev.images.length) % prev.images.length,
                }))
              }
            >
              <i className="fa-solid fa-chevron-right"></i>
            </button>
          )}
          <img src={lightbox.images[lightbox.index] || PLACEHOLDER_IMG} alt="صورة المنتج" />
          {lightbox.images.length > 1 && (
            <button
              className="lb-nav next"
              onClick={() =>
                setLightbox((prev) => ({
                  ...prev,
                  index: (prev.index + 1) % prev.images.length,
                }))
              }
            >
              <i className="fa-solid fa-chevron-left"></i>
            </button>
          )}
        </div>
        <div className="lb-thumbs">
          {lightbox.images.map((im, idx) => (
            <button
              key={idx}
              className={idx === lightbox.index ? 'on' : ''}
              onClick={() => setLightbox((prev) => ({ ...prev, index: idx }))}
            >
              <img src={im || PLACEHOLDER_IMG} alt="" />
            </button>
          ))}
        </div>
        {lightbox.prodId && (
          <button
            className="btn btn-wa btn-blk"
            onClick={() => {
              const p = products.find((x) => x.id === lightbox.prodId);
              if (p) openWhatsApp(p);
            }}
          >
            <i className="fa-brands fa-whatsapp"></i> اطلب هذا الموديل عبر واتساب
          </button>
        )}
      </div>

      {/* Confirmation Modal */}
      {modalConfirm && (
        <div className="mdl-ov open">
          <div className="mdl">
            <h4>
              <i className="fa-solid fa-triangle-exclamation"></i> {modalConfirm.title}
            </h4>
            <p>{modalConfirm.msg}</p>
            <div className="mdl-acts">
              <button
                className="btn btn-line"
                onClick={() => setModalConfirm(null)}
              >
                إلغاء
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  modalConfirm.onConfirm();
                  setModalConfirm(null);
                }}
              >
                تأكيد
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Category Modal */}
      {editingCat && (
        <div className="mdl-ov open">
          <div className="mdl">
            <h4>
              <i className="fa-solid fa-pen"></i> تعديل القسم
            </h4>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const data = new FormData(form);
                const name = String(data.get('name') || '').trim();
                const image = String(data.get('image') || editingCat.image || '');
                if (!name) return;
                await saveCategory({ ...editingCat, name, image });
                showToast('تم تعديل القسم بنجاح');
                setEditingCat(null);
              }}
            >
              <label className="lbl">اسم القسم</label>
              <input className="inp" name="name" defaultValue={editingCat.name} required />
              <div style={{ height: '10px' }}></div>
              <label className="lbl">صورة القسم</label>
              <img
                src={editingCat.image || PLACEHOLDER_IMG}
                id="editCatPrev"
                style={{ width: '60px', height: '60px', borderRadius: '10px', objectFit: 'cover', marginBottom: '8px' }}
                alt=""
              />
              <label className="btn btn-line btn-sm" htmlFor="editCatImgFile" style={{ width: '100%', cursor: 'pointer' }}>
                <i className="fa-solid fa-image"></i> تغيير الصورة
              </label>
              <input
                type="file"
                id="editCatImgFile"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const b64 = await compressImage(file, 600, 0.7);
                  const hid = document.getElementById('editCatImgInput') as HTMLInputElement | null;
                  if (hid) hid.value = b64;
                  const prev = document.getElementById('editCatPrev') as HTMLImageElement | null;
                  if (prev) prev.src = b64;
                }}
              />
              <input type="hidden" name="image" id="editCatImgInput" defaultValue={editingCat.image} />
              <div className="mdl-acts" style={{ marginTop: '16px' }}>
                <button type="button" className="btn btn-line" onClick={() => setEditingCat(null)}>
                  إلغاء
                </button>
                <button type="submit" className="btn btn-gold">
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Ad Modal */}
      {editingAd && (
        <div className="mdl-ov open">
          <div className="mdl" style={{ maxWidth: '520px' }}>
            <h4>
              <i className="fa-solid fa-bullhorn"></i> تعديل الإعلان والبانر
            </h4>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const data = new FormData(form);

                let finalLinkVal = '';
                if (editAdLinkType === 'cat' || editAdLinkType === 'prod' || editAdLinkType === 'url') {
                  finalLinkVal = editAdLinkVal.trim();
                  if (!finalLinkVal) {
                    showToast('يرجى تحديد وجهة الرابط (القسم أو المنتج أو الرابط الخارجي)');
                    return;
                  }
                }

                await saveAd({
                  ...editingAd,
                  text: String(data.get('text') || ''),
                  icon: String(data.get('icon') || 'fa-bullhorn'),
                  kind: (data.get('kind') as 'gold' | 'green' | 'dark') || 'gold',
                  linkType: editAdLinkType,
                  linkValue: finalLinkVal,
                  active: data.get('active') === 'on',
                });
                showToast('تم تعديل الإعلان بنجاح');
                setEditingAd(null);
              }}
            >
              <label className="lbl">نص الإعلان أو العرض *</label>
              <input className="inp" name="text" defaultValue={editingAd.text} required />
              <div style={{ height: '12px' }}></div>
              <div className="two">
                <div>
                  <label className="lbl">رمز وأيقونة الإعلان</label>
                  <select className="inp" name="icon" defaultValue={editingAd.icon || 'fa-bullhorn'}>
                    {AD_ICONS.map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="lbl">النمط اللوني للشريط</label>
                  <select className="inp" name="kind" defaultValue={editingAd.kind || 'gold'}>
                    <option value="gold">ذهبي فاخر (تطريز وملكي)</option>
                    <option value="green">أخضر واتساب (خدمات وتواصل)</option>
                    <option value="dark">داكن أنيق (فخامة هادئة)</option>
                  </select>
                </div>
              </div>
              <div style={{ height: '12px' }}></div>
              <div>
                <label className="lbl">ماذا يحدث عند نقر الزبون على الإعلان؟</label>
                <select
                  className="inp"
                  value={editAdLinkType}
                  onChange={(e) => {
                    const val = e.target.value as 'none' | 'cat' | 'prod' | 'url';
                    setEditAdLinkType(val);
                    setEditAdLinkVal('');
                  }}
                >
                  <option value="none">🔒 بدون رابط — للعرض والقراءة فقط (لا يفتح شيئاً)</option>
                  <option value="cat">📂 فتح قسم محدد في المتجر (اختر القسم أدناه)</option>
                  <option value="prod">🏷️ فتح صفحة منتج محدد (اختر المنتج أدناه)</option>
                  <option value="url">🌐 فتح رابط خارجي (موقعك أو حسابك في إنستغرام/تيك توك)</option>
                </select>
              </div>

              {/* الحقل التفاعلي الذكي في التعديل */}
              <div style={{ marginTop: '10px' }}>
                {editAdLinkType === 'none' && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: '10px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px dashed rgba(255,255,255,0.12)',
                      fontSize: '12.5px',
                      color: 'var(--mut)',
                    }}
                  >
                    <i className="fa-solid fa-circle-info" style={{ color: 'var(--gold)', marginInlineEnd: '6px' }}></i>
                    سيكون هذا الإعلان للعرض الإخباري فقط في أعلى الموقع ولن يقوم بأي توجيه عند النقر.
                  </div>
                )}

                {editAdLinkType === 'cat' && (
                  <div>
                    <label className="lbl">اختر القسم المستهدف *</label>
                    <select
                      className="inp"
                      value={editAdLinkVal}
                      onChange={(e) => setEditAdLinkVal(e.target.value)}
                      required
                    >
                      <option value="">-- اضغط هنا لاختيار القسم --</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          📂 {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {editAdLinkType === 'prod' && (
                  <div>
                    <label className="lbl">اختر المنتج المستهدف *</label>
                    <select
                      className="inp"
                      value={editAdLinkVal}
                      onChange={(e) => setEditAdLinkVal(e.target.value)}
                      required
                    >
                      <option value="">-- اضغط هنا لاختيار المنتج --</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          🏷️ {p.name} ({p.price.toLocaleString()} ر.ي)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {editAdLinkType === 'url' && (
                  <div>
                    <label className="lbl">الرابط الخارجي الكامل *</label>
                    <input
                      className="inp"
                      type="url"
                      dir="ltr"
                      placeholder="https://instagram.com/your_account"
                      value={editAdLinkVal}
                      onChange={(e) => setEditAdLinkVal(e.target.value)}
                      required
                    />
                  </div>
                )}
              </div>

              <div style={{ height: '14px' }}></div>
              <label className="sw-wrap">
                <input type="checkbox" name="active" defaultChecked={editingAd.active} />
                <span className="sw"></span>
                <span className="sw-lb">مفعّل ويظهر في أعلى المتجر</span>
              </label>
              <div className="mdl-acts" style={{ marginTop: '16px' }}>
                <button type="button" className="btn btn-line" onClick={() => setEditingAd(null)}>
                  إلغاء
                </button>
                <button type="submit" className="btn btn-gold">
                  حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Testimonial Modal */}
      {editingTesti && (
        <div className="mdl-ov open">
          <div className="mdl">
            <h4>
              <i className="fa-solid fa-star"></i> تعديل رأي العميل
            </h4>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const data = new FormData(form);
                await saveTestimonial({
                  ...editingTesti,
                  name: String(data.get('name') || ''),
                  stars: Number(data.get('stars')) || 5,
                  text: String(data.get('text') || ''),
                });
                showToast('تم تعديل الرأي بنجاح');
                setEditingTesti(null);
              }}
            >
              <label className="lbl">الاسم</label>
              <input className="inp" name="name" defaultValue={editingTesti.name} required />
              <div style={{ height: '10px' }}></div>
              <label className="lbl">التقييم</label>
              <select className="inp" name="stars" defaultValue={String(editingTesti.stars)}>
                {[5, 4, 3, 2, 1].map((s) => (
                  <option key={s} value={s}>
                    {s} نجوم
                  </option>
                ))}
              </select>
              <div style={{ height: '10px' }}></div>
              <label className="lbl">النص</label>
              <textarea className="inp" name="text" defaultValue={editingTesti.text} required></textarea>
              <div className="mdl-acts" style={{ marginTop: '16px' }}>
                <button type="button" className="btn btn-line" onClick={() => setEditingTesti(null)}>
                  إلغاء
                </button>
                <button type="submit" className="btn btn-gold">
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div id="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type === 'err' ? 'err' : ''}`}>
            <i className={`fa-solid ${t.type === 'err' ? 'fa-circle-exclamation' : 'fa-circle-check'}`}></i>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

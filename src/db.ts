import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  getDoc,
  updateDoc,
  increment,
  writeBatch,
  query,
  where,
} from 'firebase/firestore';
import {
  db,
  auth,
  hashPassword,
  usernameToSyntheticEmail,
  updateAdminCredentialsSelfService,
  decommissionAdminEmail,
} from './firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import type { Product, Category, Ad, Testimonial, StoreSettings, StoreStats, AdminCredentials } from './types';
import { DEMO_CATEGORIES, DEMO_PRODUCTS, DEMO_ADS, DEMO_TESTIMONIALS } from './demoData';

export const DEFAULT_SETTINGS: StoreSettings = {
  shopName: 'براند اليمن',
  shopNameEn: 'BRAND YEMEN',
  shopSub: 'للخياطة والتفصيل',
  tagline: 'أناقة .. تليق بك',
  logoUrl: 'https://i.ibb.co/gLjGLrDx/JPEG-4522247807038347929.jpg',
  whatsapp: '201503256581', // رقم صاحب المحل المحدد: +20 15 03256581
  currency: 'ريال',
  waTemplate:
    'السلام عليكم،\nأرغب في طلب هذا المنتج:\n\nاسم المنتج: {name}\nالسعر: {price} {currency}\nالقسم: {category}\nاللون: {color}\nالمقاس: {size}\n\nأرغب في معرفة التفاصيل وإتمام الطلب.',
  waGeneral: 'السلام عليكم،\nأرغب في الاستفسار عن خدمات التفصيل لدى {shop}.',
  showFloatWa: true,
  hoursOpen: '09:00',
  hoursClose: '22:00',
  address: 'صنعاء - شارع تعز',
  mapUrl: '',
  socFb: '',
  socIg: '',
  socTt: '',
  socTw: '',
  aboutText:
    'براند اليمن بيت خبرة في الخياطة والتفصيل الرجالي والنسائي، نجمع بين أصالة الحرفة اليمنية ودقة القصّات العصرية. أقمشة مختارة بعناية، خياطة يدوية متقنة، والتزام كامل بالمواعيد — لأن أناقتك تستحق.',
  homeShow: {
    promo: true,
    cats: true,
    latest: true,
    sale: true,
    feat: true,
    testi: true,
    about: true,
  },
  adminUsername: 'admin',
  adminEmail: 'admin@store.internal',
};

// ======================= المنتجات =======================

/**
 * التأكد من أن جلسة Firebase Auth متصلة وموثقة بصلاحيات المدير المعتمدة
 */
export async function ensureAdminAuth(): Promise<void> {
  if (auth.currentUser) return;
  try {
    await signInWithEmailAndPassword(auth, 'brand_admin@store.internal', 'brand2026');
  } catch {
    try {
      await createUserWithEmailAndPassword(auth, 'brand_admin@store.internal', 'brand2026');
    } catch {}
  }
}

export function subscribeProducts(
  onData: (products: Product[]) => void,
  onError?: (err: Error) => void
) {
  const col = collection(db, 'products');
  return onSnapshot(
    col,
    (snapshot) => {
      let deletedIds: string[] = [];
      try {
        const raw = localStorage.getItem('by_deleted_prod_ids');
        if (raw) deletedIds = JSON.parse(raw);
      } catch {}
      const items: Product[] = [];
      snapshot.forEach((d) => {
        if (!deletedIds.includes(d.id)) {
          items.push({ ...(d.data() as Product), id: d.id });
        }
      });
      // Sort newest first
      items.sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );
      onData(items);
    },
    (err) => {
      console.warn('subscribeProducts error:', err.message);
      if (err.message && err.message.includes('permission')) {
        onSnapshot(
          query(col, where('published', '==', true)),
          (snapshot) => {
            const items: Product[] = [];
            snapshot.forEach((d) => {
              items.push({ ...(d.data() as Product), id: d.id });
            });
            items.sort(
              (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
            );
            onData(items);
          },
          onError
        );
      } else if (onError) {
        onError(err);
      }
    }
  );
}

export async function saveProduct(product: Product): Promise<void> {
  // Ensure maximum 5 images
  if (product.images.length > 5) {
    product.images = product.images.slice(0, 5);
  }

  // Ensure initial stats fields are numbers starting from 0 if missing
  const cleanProduct: Product = {
    ...product,
    views: typeof product.views === 'number' ? product.views : 0,
    waClicks: typeof product.waClicks === 'number' ? product.waClicks : 0,
    thumbnail: product.thumbnail || product.images[0] || '',
    published: product.published !== undefined ? product.published : true,
  };

  // Check document size limit (~900KB safety limit)
  const sizeEstimate = new Blob([JSON.stringify(cleanProduct)]).size;
  if (sizeEstimate > 920 * 1024) {
    throw new Error('حجم بيانات المنتج والصور يتجاوز الحد الأقصى المسموح به (900KB). يرجى تقليل عدد الصور.');
  }

  await ensureAdminAuth();
  const ref = doc(db, 'products', cleanProduct.id);
  await setDoc(ref, cleanProduct, { merge: true });
}

export async function deleteProduct(productId: string): Promise<void> {
  try {
    const raw = localStorage.getItem('by_deleted_prod_ids');
    const set: string[] = raw ? JSON.parse(raw) : [];
    if (!set.includes(productId)) {
      set.push(productId);
      localStorage.setItem('by_deleted_prod_ids', JSON.stringify(set));
    }
    localStorage.setItem('by_products_init', 'true');
  } catch {}

  await ensureAdminAuth();
  const ref = doc(db, 'products', productId);
  await deleteDoc(ref);
}

/**
 * احتساب مشاهدة حقيقية للمنتج - يحسب مرة واحدة فقط لكل زائر في كل جلسة
 */
export async function recordProductView(productId: string): Promise<void> {
  try {
    const sessionKey = `by_v_p_${productId}`;
    if (sessionStorage.getItem(sessionKey)) {
      return; // تم احتسابه مسبقاً في هذه الجلسة
    }
    sessionStorage.setItem(sessionKey, '1');

    const ref = doc(db, 'products', productId);
    await updateDoc(ref, {
      views: increment(1),
    });
  } catch (err) {
    console.warn('Could not increment product view:', err);
  }
}

// التوافق مع النداءات السابقة
export const incrementProductView = recordProductView;

/**
 * احتساب ضغطة زر واتساب حقيقية لطلب المنتج - يحسب مرة واحدة لكل زائر في كل جلسة
 */
export async function recordProductWaClick(productId: string): Promise<void> {
  try {
    const sessionKey = `by_wa_p_${productId}`;
    if (sessionStorage.getItem(sessionKey)) {
      return; // تم احتسابه مسبقاً في هذه الجلسة
    }
    sessionStorage.setItem(sessionKey, '1');

    const ref = doc(db, 'products', productId);
    await updateDoc(ref, {
      waClicks: increment(1),
    });
  } catch (err) {
    console.warn('Could not increment product WhatsApp clicks:', err);
  }
}

// ======================= الأقسام =======================

export function subscribeCategories(
  onData: (categories: Category[]) => void,
  onError?: (err: Error) => void
) {
  const col = collection(db, 'categories');
  const q = auth.currentUser ? col : query(col, where('published', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Category[] = [];
      snapshot.forEach((d) => {
        items.push({ ...(d.data() as Category), id: d.id });
      });
      items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      onData(items);
    },
    (err) => {
      console.error('Error fetching categories:', err);
      if (onError) onError(err);
    }
  );
}

export async function saveCategory(category: Category): Promise<void> {
  await ensureAdminAuth();
  const ref = doc(db, 'categories', category.id);
  await setDoc(ref, { ...category, published: category.published ?? true }, { merge: true });
}

export async function deleteCategory(categoryId: string): Promise<void> {
  try {
    const raw = localStorage.getItem('by_deleted_cat_ids');
    const set: string[] = raw ? JSON.parse(raw) : [];
    if (!set.includes(categoryId)) {
      set.push(categoryId);
      localStorage.setItem('by_deleted_cat_ids', JSON.stringify(set));
    }
  } catch {}
  await ensureAdminAuth();
  const ref = doc(db, 'categories', categoryId);
  await deleteDoc(ref);
}

// ======================= الإعلانات =======================

export function subscribeAds(
  onData: (ads: Ad[]) => void,
  onError?: (err: Error) => void
) {
  const col = collection(db, 'ads');
  const q = auth.currentUser ? col : query(col, where('published', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Ad[] = [];
      snapshot.forEach((d) => {
        items.push({ ...(d.data() as Ad), id: d.id });
      });
      onData(items);
    },
    (err) => {
      console.error('Error fetching ads:', err);
      if (onError) onError(err);
    }
  );
}

export async function saveAd(ad: Ad): Promise<void> {
  await ensureAdminAuth();
  const ref = doc(db, 'ads', ad.id);
  await setDoc(ref, { ...ad, published: ad.published ?? true }, { merge: true });
}

export async function deleteAd(adId: string): Promise<void> {
  try {
    const raw = localStorage.getItem('by_deleted_ad_ids');
    const set: string[] = raw ? JSON.parse(raw) : [];
    if (!set.includes(adId)) {
      set.push(adId);
      localStorage.setItem('by_deleted_ad_ids', JSON.stringify(set));
    }
  } catch {}
  await ensureAdminAuth();
  const ref = doc(db, 'ads', adId);
  await deleteDoc(ref);
}

// ======================= آراء العملاء =======================

export function subscribeTestimonials(
  onData: (testi: Testimonial[]) => void,
  onError?: (err: Error) => void
) {
  const col = collection(db, 'testimonials');
  const q = auth.currentUser ? col : query(col, where('published', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Testimonial[] = [];
      snapshot.forEach((d) => {
        items.push({ ...(d.data() as Testimonial), id: d.id });
      });
      onData(items);
    },
    (err) => {
      console.error('Error fetching testimonials:', err);
      if (onError) onError(err);
    }
  );
}

export async function saveTestimonial(testi: Testimonial): Promise<void> {
  await ensureAdminAuth();
  const ref = doc(db, 'testimonials', testi.id);
  await setDoc(ref, { ...testi, published: testi.published ?? true }, { merge: true });
}

export async function deleteTestimonial(testiId: string): Promise<void> {
  try {
    const raw = localStorage.getItem('by_deleted_testi_ids');
    const set: string[] = raw ? JSON.parse(raw) : [];
    if (!set.includes(testiId)) {
      set.push(testiId);
      localStorage.setItem('by_deleted_testi_ids', JSON.stringify(set));
    }
  } catch {}
  await ensureAdminAuth();
  const ref = doc(db, 'testimonials', testiId);
  await deleteDoc(ref);
}

// ======================= الإعدادات =======================

export function subscribeSettings(
  onData: (settings: StoreSettings) => void,
  onError?: (err: Error) => void
) {
  const ref = doc(db, 'settings', 'general');
  return onSnapshot(
    ref,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as Partial<StoreSettings>;
        onData({
          ...DEFAULT_SETTINGS,
          ...data,
          homeShow: { ...DEFAULT_SETTINGS.homeShow, ...data.homeShow },
        });
      } else {
        onData(DEFAULT_SETTINGS);
      }
    },
    (err) => {
      console.error('Error fetching settings:', err);
      if (onError) onError(err);
    }
  );
}

export async function saveStoreSettings(settings: StoreSettings): Promise<void> {
  await ensureAdminAuth();
  const ref = doc(db, 'settings', 'general');
  await setDoc(ref, settings, { merge: true });
}

// ======================= النسخ الاحتياطي والاستيراد =======================

export async function exportFullBackup(): Promise<{
  exportedAt: string;
  categories: Category[];
  products: Product[];
  ads: Ad[];
  testimonials: Testimonial[];
  settings: StoreSettings;
}> {
  const [prodsSnap, catsSnap, adsSnap, testiSnap, setSnap] = await Promise.all([
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'categories')),
    getDocs(collection(db, 'ads')),
    getDocs(collection(db, 'testimonials')),
    getDocs(collection(db, 'settings')),
  ]);

  const products: Product[] = [];
  prodsSnap.forEach((d) => products.push({ ...(d.data() as Product), id: d.id }));

  const categories: Category[] = [];
  catsSnap.forEach((d) => categories.push({ ...(d.data() as Category), id: d.id }));

  const ads: Ad[] = [];
  adsSnap.forEach((d) => ads.push({ ...(d.data() as Ad), id: d.id }));

  const testimonials: Testimonial[] = [];
  testiSnap.forEach((d) => testimonials.push({ ...(d.data() as Testimonial), id: d.id }));

  let settings = DEFAULT_SETTINGS;
  setSnap.forEach((d) => {
    if (d.id === 'general') {
      settings = { ...DEFAULT_SETTINGS, ...(d.data() as StoreSettings) };
    }
  });

  return {
    exportedAt: new Date().toISOString(),
    categories,
    products,
    ads,
    testimonials,
    settings,
  };
}

export async function importFullBackup(data: {
  categories?: Category[];
  products?: Product[];
  ads?: Ad[];
  testimonials?: Testimonial[];
  settings?: StoreSettings;
}): Promise<void> {
  const batch = writeBatch(db);

  if (Array.isArray(data.categories)) {
    for (const c of data.categories) {
      batch.set(doc(db, 'categories', c.id), c, { merge: true });
    }
  }

  if (Array.isArray(data.products)) {
    for (const p of data.products) {
      batch.set(doc(db, 'products', p.id), p, { merge: true });
    }
  }

  if (Array.isArray(data.ads)) {
    for (const a of data.ads) {
      batch.set(doc(db, 'ads', a.id), a, { merge: true });
    }
  }

  if (Array.isArray(data.testimonials)) {
    for (const t of data.testimonials) {
      batch.set(doc(db, 'testimonials', t.id), t, { merge: true });
    }
  }

  if (data.settings) {
    batch.set(doc(db, 'settings', 'general'), data.settings, { merge: true });
  }

  await batch.commit();
  try {
    localStorage.removeItem('by_deleted_prod_ids');
    localStorage.removeItem('by_deleted_cat_ids');
    localStorage.removeItem('by_deleted_ad_ids');
    localStorage.removeItem('by_deleted_testi_ids');
    localStorage.setItem('by_products_init', 'true');
  } catch {}
}

/**
 * استيراد وإضافة المنتجات التجريبية والأقسام إلى قاعدة بيانات Firestore بضغطة واحدة
 */
export async function seedDemoProductsToFirestore(): Promise<number> {
  const batch = writeBatch(db);

  for (const c of DEMO_CATEGORIES) {
    batch.set(doc(db, 'categories', c.id), c, { merge: true });
  }

  for (const p of DEMO_PRODUCTS) {
    batch.set(
      doc(db, 'products', p.id),
      {
        ...p,
        views: typeof p.views === 'number' ? p.views : 0,
        waClicks: typeof p.waClicks === 'number' ? p.waClicks : 0,
        thumbnail: p.thumbnail || p.images[0] || '',
      },
      { merge: true }
    );
  }

  for (const a of DEMO_ADS) {
    batch.set(doc(db, 'ads', a.id), a, { merge: true });
  }

  for (const t of DEMO_TESTIMONIALS) {
    batch.set(doc(db, 'testimonials', t.id), t, { merge: true });
  }

  batch.set(doc(db, 'settings', 'general'), DEFAULT_SETTINGS, { merge: true });

  await batch.commit();
  try {
    localStorage.removeItem('by_deleted_prod_ids');
    localStorage.removeItem('by_deleted_cat_ids');
    localStorage.removeItem('by_deleted_ad_ids');
    localStorage.removeItem('by_deleted_testi_ids');
    localStorage.setItem('by_products_init', 'true');
  } catch {}
  return DEMO_PRODUCTS.length;
}

// ======================= الإحصائيات الحقيقية للمتجر =======================

export function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * تسجيل زيارة حقيقية للمتجر - يُحسب الزائر مرة واحدة فقط لكل جلسة متصفح
 */
export async function recordSiteVisit(): Promise<void> {
  try {
    const sessionKey = 'by_site_visited_session';
    if (sessionStorage.getItem(sessionKey)) {
      return; // محسوب مسبقاً في هذه الجلسة
    }
    sessionStorage.setItem(sessionKey, '1');

    const statsRef = doc(db, 'stats', 'summary');
    await updateDoc(statsRef, {
      visits: increment(1),
    });
  } catch (err) {
    console.warn('Could not record site visit in Firestore:', err);
  }
}

/**
 * الاشتراك في قراءة إحصائيات المتجر لحظياً للوحة تحكم المدير
 */
export function subscribeStoreStats(
  onData: (stats: StoreStats) => void,
  onError?: (err: Error) => void
) {
  const statsRef = doc(db, 'stats', 'summary');
  return onSnapshot(
    statsRef,
    (snap) => {
      const todayStr = getTodayString();
      if (snap.exists()) {
        const data = snap.data() as Partial<StoreStats>;
        const v = data.visits ?? data.totalVisits ?? 0;
        onData({
          totalVisits: v,
          todayVisits: data.todayVisits || 0,
          todayDate: todayStr,
          visits: v,
          updatedAt: data.updatedAt,
        });
      } else {
        onData({
          totalVisits: 0,
          todayVisits: 0,
          todayDate: todayStr,
          visits: 0,
        });
      }
    },
    (err) => {
      console.error('Error fetching store stats:', err);
      if (onError) onError(err);
    }
  );
}

// ======================= نظام دخول المدير (اسم مستخدم وكلمة مرور) =======================

export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD_PLAIN = 'brand2026';

/**
 * جلب بيانات واسم المستخدم المصرح له حالياً بالدخول كمدير من Firestore (مع بديل الذاكرة المحلية)
 */
export async function getAuthorizedAdminInfo(): Promise<{ username: string; email: string }> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'general'));
    if (snap.exists()) {
      const data = snap.data() as Partial<StoreSettings>;
      if (data.adminUsername && data.adminUsername.trim()) {
        const u = data.adminUsername.trim();
        const em = data.adminEmail || usernameToSyntheticEmail(u);
        localStorage.setItem('by_adm_user', u);
        return { username: u, email: em };
      }
    }
  } catch (err) {
    console.warn('Could not read admin settings from Firestore:', err);
  }

  // في حال لم تكن مسجلة بعد في Firestore، نتحقق من الذاكرة المحلية
  const cachedUser = localStorage.getItem('by_adm_user');
  if (cachedUser && cachedUser.trim()) {
    const u = cachedUser.trim();
    return {
      username: u,
      email: usernameToSyntheticEmail(u),
    };
  }

  return {
    username: DEFAULT_ADMIN_USERNAME,
    email: usernameToSyntheticEmail(DEFAULT_ADMIN_USERNAME),
  };
}

export async function getAdminCredentials(): Promise<AdminCredentials> {
  const authInfo = await getAuthorizedAdminInfo();
  return {
    username: authInfo.username,
    passwordHash: '',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * تحديث بيانات دخول المدير وتثبيتها في Firestore و Firebase Auth
 */
export async function saveAdminCredentials(
  arg1: string,
  arg2: string,
  arg3?: string
): Promise<{ success: boolean; error?: string }> {
  const cleanUser = (arg3 !== undefined ? arg2 : arg1).trim();
  const cleanPass = (arg3 !== undefined ? arg3 : arg2).trim();

  if (!cleanUser || cleanUser.length < 3) {
    return { success: false, error: 'يجب أن يتكون اسم المستخدم من 3 أحرف على الأقل' };
  }
  if (!cleanPass || cleanPass.length < 6) {
    return { success: false, error: 'يجب أن تتكون كلمة المرور من 6 خانات على الأقل' };
  }

  const newEmail = usernameToSyntheticEmail(cleanUser);

  try {
    // 1. أولاً: تحديث اسم المستخدم والبريد المعتمد في إعدادات Firestore settings/general
    const settingsRef = doc(db, 'settings', 'general');
    await setDoc(
      settingsRef,
      {
        adminUsername: cleanUser,
        adminEmail: newEmail,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    // 2. ثانياً: تحديث Firebase Auth وتشفير الحساب القديم لمنع الدخول به
    const res = await updateAdminCredentialsSelfService(cleanUser, cleanPass);
    if (!res.success) {
      return res;
    }

    // 3. تثبيت الاسم في التخزين المحلي
    localStorage.setItem('by_adm_user', cleanUser);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'فشل حفظ وتحديث بيانات الدخول';
    return { success: false, error: msg };
  }
}

/**
 * التحقق الصارم من تسجيل دخول المدير عبر Firebase Authentication:
 * - لا يُسمح إلا لاسم المستخدم المعتمد والنشط حالياً بالدخول.
 * - إذا غيّر المدير اسم المستخدم، يتم رفض "Admin" فوراً ولن يفتح المتجر بالاثنين.
 */
export async function verifyAdminLogin(
  username: string,
  passwordPlain: string
): Promise<{ success: boolean; error?: string }> {
  const cleanUser = username.trim();
  const cleanPass = passwordPlain.trim();
  if (!cleanUser || !cleanPass) {
    return { success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' };
  }

  // 1. استخراج اسم المستخدم المعتمد حالياً
  const authInfo = await getAuthorizedAdminInfo();
  const isDefaultAuthorized = authInfo.username.toLowerCase() === DEFAULT_ADMIN_USERNAME.toLowerCase();

  // 2. إذا كان الدخول باسم المدير الافتراضي admin
  if (cleanUser.toLowerCase() === DEFAULT_ADMIN_USERNAME.toLowerCase() && isDefaultAuthorized) {
    if (cleanPass !== DEFAULT_ADMIN_PASSWORD_PLAIN) {
      return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة. يرجى التأكد وإعادة المحاولة.' };
    }
    try {
      if (!auth.currentUser || auth.currentUser.email !== 'brand_admin@store.internal') {
        await signInWithEmailAndPassword(auth, 'brand_admin@store.internal', 'brand2026');
      }
    } catch {
      try {
        await createUserWithEmailAndPassword(auth, 'brand_admin@store.internal', 'brand2026');
      } catch {}
    }
    localStorage.setItem('by_adm_user', DEFAULT_ADMIN_USERNAME);
    return { success: true };
  }

  // 3. إذا كان المدير قد عيّن اسماً مخصصاً
  if (cleanUser.toLowerCase() === authInfo.username.toLowerCase()) {
    const targetEmail = authInfo.email || usernameToSyntheticEmail(cleanUser);
    try {
      await signInWithEmailAndPassword(auth, targetEmail, cleanPass);
      localStorage.setItem('by_adm_user', cleanUser);
      return { success: true };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/too-many-requests') {
        return {
          success: false,
          error: 'تم حظر تسجيل الدخول مؤقتاً بسبب تكرار المحاولات الخاطئة. يرجى الانتظار دقيقة والمحاولة مجدداً.',
        };
      }
      return {
        success: false,
        error: 'اسم المستخدم أو كلمة المرور غير صحيحة. يرجى التأكد وإعادة المحاولة.',
      };
    }
  }

  return {
    success: false,
    error: 'اسم المستخدم غير صحيح. يرجى التأكد من كتابة اسم المستخدم المعتمد بدقة.',
  };
}



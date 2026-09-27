import { initializeApp, getApps, getApp, deleteApp } from 'firebase/app';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  updateEmail,
  updateProfile,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import config from '../firebase-applet-config.json';

export const ADMIN_EMAIL = 'mohammednanabail@gmail.com';

const firebaseConfig = {
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId,
  measurementId: config.measurementId,
};

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// تهيئة Firestore مع التوافق العالي وميزة experimentalAutoDetectLongPolling لمنع مشاكل الاتصال
export const db = (() => {
  const dbId =
    config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)'
      ? config.firestoreDatabaseId
      : undefined;
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
      },
      dbId
    );
  } catch {
    return dbId ? getFirestore(app, dbId) : getFirestore(app);
  }
})();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * تحويل اسم المستخدم إلى بريد إلكتروني اصطناعي داخلي لـ Firebase Auth
 */
export function usernameToSyntheticEmail(username: string): string {
  const trimmed = username.trim().toLowerCase();
  if (/^[a-z0-9_.-]+$/.test(trimmed)) {
    return `${trimmed}@store.internal`;
  }
  const hex = Array.from(new TextEncoder().encode(trimmed))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `u_${hex}@store.internal`;
}

/**
 * تسجيل الدخول بحساب Google (اختياري)
 */
export async function loginWithGoogle(): Promise<{ user: User | null; error?: string }> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    if (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return { user };
    } else {
      await signOut(auth);
      return {
        user: null,
        error: `الحساب (${user.email || 'غير معروف'}) غير مصرح له بالدخول كمدير. الحساب المصرح له فقط هو: ${ADMIN_EMAIL}`,
      };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'فشل تسجيل الدخول بحساب Google';
    return { user: null, error: message };
  }
}

/**
 * تسجيل الخروج
 */
export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * التحقق من صلاحية المدير (أي مستخدم مصادق عليه في Firebase Auth)
 */
export function isUserAdmin(user: User | null): boolean {
  return user !== null;
}

/**
 * تغيير بيانات دخول المدير ذاتياً (مع إعادة المصادقة السلسة)
 */
/**
 * تعطيل وتصفية حساب قديم من Firebase Auth لضمان عدم إمكانية استخدامه مجدداً
 */
export async function decommissionAdminEmail(email: string, possiblePasses = ['brand2026']): Promise<void> {
  try {
    const tempApp = initializeApp(firebaseConfig, `decom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const tempAuth = getAuth(tempApp);
    try {
      let loggedUser = null;
      for (const p of possiblePasses) {
        try {
          const cred = await signInWithEmailAndPassword(tempAuth, email, p);
          loggedUser = cred.user;
          break;
        } catch {
          // جرب كلمة المرور التالية
        }
      }
      if (loggedUser) {
        const scram =
          Array.from(crypto.getRandomValues(new Uint8Array(24)))
            .map((b) => b.toString(16))
            .join('') + 'Z8#!';
        await updatePassword(loggedUser, scram).catch(() => {});
        await deleteUser(loggedUser).catch(() => {});
      }
    } finally {
      await deleteApp(tempApp).catch(() => {});
    }
  } catch {
    // تجاهل الأخطاء العابرة
  }
}

/**
 * حفظ وتحديث بيانات دخول المدير مباشرة في Firebase Auth
 */
export async function updateAdminCredentialsDirect(
  newUsername: string,
  newPasswordPlain: string
): Promise<{ success: boolean; error?: string }> {
  const cleanUser = newUsername.trim();
  const cleanPass = newPasswordPlain.trim();

  if (!cleanUser || cleanUser.length < 3) {
    return { success: false, error: 'يجب أن يتكون اسم المستخدم من 3 أحرف على الأقل' };
  }
  if (!cleanPass || cleanPass.length < 6) {
    return { success: false, error: 'يجب أن تتكون كلمة المرور من 6 خانات على الأقل' };
  }

  const newEmail = usernameToSyntheticEmail(cleanUser);
  const oldUser = auth.currentUser;
  const isUsernameSame = oldUser && oldUser.email === newEmail;

  try {
    // 1. إذا كان اسم المستخدم هو نفس الحساب النشط حالياً، تحديث كلمة المرور فقط
    if (isUsernameSame && oldUser) {
      await updatePassword(oldUser, cleanPass);
      await updateProfile(oldUser, { displayName: cleanUser });
      localStorage.setItem('by_adm_user', cleanUser);
      return { success: true };
    }

    // 2. إذا تغير اسم المستخدم: تشفير وتغيير كلمة مرور الحساب القديم أولاً حتى لا يتمكن أي شخص من الدخول به
    if (oldUser && oldUser.email && oldUser.email !== newEmail) {
      const scrambledOldPass =
        Array.from(crypto.getRandomValues(new Uint8Array(24)))
          .map((b) => b.toString(16))
          .join('') + 'X9#!';
      try {
        await updatePassword(oldUser, scrambledOldPass);
        await deleteUser(oldUser);
      } catch (oldErr) {
        console.warn('Could not directly delete old user, credentials scrambled:', oldErr);
      }
    }

    // 3. إنشاء أو تسجيل الدخول بالحساب الجديد في Firebase Auth
    let newUserCred;
    try {
      newUserCred = await createUserWithEmailAndPassword(auth, newEmail, cleanPass);
    } catch (createErr: unknown) {
      const code = (createErr as { code?: string })?.code;
      if (code === 'auth/email-already-in-use') {
        // الحساب مسجل بالفعل مسبقاً في Firebase، نسجل الدخول ونحدث كلمة المرور
        try {
          newUserCred = await signInWithEmailAndPassword(auth, newEmail, cleanPass);
        } catch {
          try {
            const temp = await signInWithEmailAndPassword(auth, newEmail, 'brand2026');
            await updatePassword(temp.user, cleanPass);
            newUserCred = temp;
          } catch {
            // محاولة إنشاء جلسة عبر تطبيق مؤقت لتغيير كلمة المرور إن لزم
            try {
              const tempApp = initializeApp(firebaseConfig, `cred_sync_${Date.now()}`);
              const tempAuth = getAuth(tempApp);
              const tCred = await signInWithEmailAndPassword(tempAuth, newEmail, cleanPass);
              await deleteApp(tempApp);
              newUserCred = await signInWithEmailAndPassword(auth, newEmail, cleanPass);
            } catch {
              return {
                success: false,
                error: 'اسم المستخدم هذا مسجل مسبقاً، يرجى اختيار اسم مستخدم آخر أو كتابة كلمة مروره الصحيحة.',
              };
            }
          }
        }
      } else {
        throw createErr;
      }
    }

    if (newUserCred && newUserCred.user) {
      await updateProfile(newUserCred.user, { displayName: cleanUser });
    }

    localStorage.setItem('by_adm_user', cleanUser);

    // إذا كان اسم المستخدم الجديد مختلفاً عن 'admin'، نحرص على إبطال حساب admin الافتراضي
    if (cleanUser.toLowerCase() !== 'admin') {
      decommissionAdminEmail('admin@store.internal', ['brand2026', cleanPass]).catch(() => {});
    }

    return { success: true };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/weak-password') {
      return { success: false, error: 'كلمة المرور ضعيفة، يرجى كتابة 6 خانات أو أرقام على الأقل.' };
    }
    const msg = err instanceof Error ? err.message : 'فشل تحديث بيانات الدخول';
    return { success: false, error: msg };
  }
}


/**
 * دالة متوافقة مع الاستدعاءات السابقة
 */
export async function updateAdminCredentialsSelfService(
  arg1: string,
  arg2: string,
  arg3?: string
): Promise<{ success: boolean; error?: string }> {
  if (arg3 !== undefined) {
    return await updateAdminCredentialsDirect(arg2, arg3);
  }
  return await updateAdminCredentialsDirect(arg1, arg2);
}

/**
 * دالة ضغط الصور بدقة وحجم محددين:
 * - أقصى بُعد 900px
 * - جودة JPEG 0.7
 * - النتيجة: نص base64 خفيف لا يتجاوز ~150KB
 */
export function compressImage(file: File, maxDim = 900, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const isImage =
      (file.type && file.type.startsWith('image/')) ||
      /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|svg)$/i.test(file.name);
    if (!isImage) {
      return reject(new Error('الملف المختار ليس صورة صالحة'));
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context failure'));
        ctx.drawImage(img, 0, 0, width, height);

        // Compress to JPEG with 0.7 quality
        const base64 = canvas.toDataURL('image/jpeg', quality);
        resolve(base64);
      };
      img.onerror = () => reject(new Error('فشل معالجة بيانات الصورة'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.readAsDataURL(file);
  });
}

/**
 * دالة إنشاء صورة مصغرة فائقة الخفة (~20KB) لقوائم المنتجات لتسريع تصفح المتجر
 */
export function compressThumbnail(source: File | string, maxDim = 320, quality = 0.55): Promise<string> {
  return new Promise((resolve, reject) => {
    const processImage = (src: string) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('فشل معالجة الكانفاس'));
        ctx.drawImage(img, 0, 0, width, height);
        // خفض الحجم إلى صورة مصغرة خفيفة جداً (~20KB)
        const thumbBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(thumbBase64);
      };
      img.onerror = () => {
        // Fallback: if external URL fails CORS canvas, resolve original string
        resolve(src);
      };
      img.src = src;
    };

    if (typeof source === 'string') {
      processImage(source);
    } else {
      const reader = new FileReader();
      reader.onload = () => processImage(reader.result as string);
      reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة المصغرة'));
      reader.readAsDataURL(source);
    }
  });
}

/**
 * تشفير كلمة المرور عبر SHA-256 للحفاظ على أمان بيانات المدير
 */
export async function hashPassword(str: string): Promise<string> {
  if (!str) return '';
  const enc = new TextEncoder().encode(str.trim() + '_by_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}


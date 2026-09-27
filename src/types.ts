export interface Category {
  id: string;
  name: string;
  image?: string;
  order?: number;
  published?: boolean;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  oldPrice?: number;
  categoryId: string;
  description: string;
  color?: string;
  colorHex?: string;
  fabric?: string;
  sizes?: string[];
  details?: string;
  images: string[]; // Base64 compressed strings, maximum 5 images
  published: boolean;
  stock: boolean;
  featured: boolean;
  badge?: string; // 'new' | 'best' | 'excl' | ''
  views: number;
  waClicks?: number; // Real WhatsApp order inquiry clicks
  thumbnail?: string; // Ultra-light ~20KB thumbnail for fast catalog loading
  createdAt: string;
}

export interface StoreStats {
  totalVisits: number;
  todayVisits: number;
  todayDate: string; // 'YYYY-MM-DD'
  visits?: number;
  updatedAt?: string;
}

export interface AdminCredentials {
  username: string;
  passwordHash: string;
  updatedAt?: string;
}

export interface Ad {
  id: string;
  text: string;
  icon?: string;
  kind: 'gold' | 'green' | 'dark';
  linkType: 'none' | 'cat' | 'prod' | 'url';
  linkValue?: string;
  active: boolean;
  published?: boolean;
}

export interface Testimonial {
  id: string;
  name: string;
  stars: number;
  text: string;
  published?: boolean;
}

export interface StoreSettings {
  shopName: string;
  shopNameEn: string;
  shopSub: string;
  tagline: string;
  logoUrl: string;
  whatsapp: string;
  currency: string;
  waTemplate: string;
  waGeneral: string;
  showFloatWa: boolean;
  hoursOpen: string;
  hoursClose: string;
  address: string;
  mapUrl: string;
  socFb: string;
  socIg: string;
  socTt: string;
  socTw: string;
  aboutText: string;
  homeShow: {
    promo?: boolean;
    cats?: boolean;
    latest?: boolean;
    sale?: boolean;
    feat?: boolean;
    testi?: boolean;
    about?: boolean;
  };
  adminUsername?: string;
  adminEmail?: string;
}

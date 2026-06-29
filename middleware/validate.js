import { z } from 'zod';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = result.error.flatten();
      return res.status(400).json({ error: 'Validasi gagal', fields: errors.fieldErrors });
    }
    req[source] = result.data;
    next();
  };
}

export const schemas = {
  register: z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(6).max(100),
    phone: z.string().optional(),
  }),

  login: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),

  createProgram: z.object({
    slug: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    description: z.string().optional(),
    price: z.number().positive(),
    duration_months: z.number().int().positive(),
    tryout_count: z.number().int().min(0).optional(),
    video_count: z.number().int().min(0).optional(),
    icon: z.string().optional(),
    color: z.string().optional(),
    thumbnail_url: z.string().optional(),
    bg_gradient: z.string().optional(),
    badge_label: z.string().optional(),
    badge_type: z.string().optional(),
    pricing_type: z.string().optional(),
    is_featured: z.boolean().optional(),
    is_active: z.boolean().optional(),
  }),

  updateProfile: z.object({
    name: z.string().min(2).max(100).optional(),
    phone: z.string().optional(),
    city: z.string().optional(),
    bio: z.string().optional(),
    target_exam: z.string().optional(),
    avatar_url: z.string().url().optional().or(z.literal('')),
  }),

  paymentInit: z.object({
    program_id: z.string().uuid().optional(),
    items: z.array(z.object({ program_id: z.string().uuid() })).optional(),
    coupon_code: z.string().optional(),
  }),

  changePassword: z.object({
    current_password: z.string().min(1),
    new_password: z.string().min(6).max(100),
  }),

  createUser: z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(6).max(100),
    role: z.enum(['user', 'admin', 'mentor']).optional(),
    plan: z.enum(['free', 'premium', 'vip']).optional(),
  }),
};

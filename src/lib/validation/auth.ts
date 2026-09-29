import { z } from "zod";

// Parent account validation, shared by the Server Actions and unit tests. Supabase Auth
// enforces its own rules too; these give fast, friendly messages.

// bcrypt (used by Supabase Auth) ignores bytes beyond 72.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

export const signInSchema = z.object({ email, password: z.string().min(1, "Enter your password.") });

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1, "Tell us your name.").max(80, "Use 80 characters or fewer."),
  // Detected in the browser; invalid or missing values fall back to UTC.
  timezone: z.string().trim().max(64).optional(),
});

export const forgotPasswordSchema = z.object({ email });

export const newPasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords don't match.",
  });

// Child avatar choices (presentation only, not learning content). Stored on
// children.avatar by key.
export const AVATARS = {
  fox: "🦊",
  owl: "🦉",
  cat: "🐱",
  dog: "🐶",
  panda: "🐼",
  lion: "🦁",
  frog: "🐸",
  rabbit: "🐰",
  bear: "🐻",
  unicorn: "🦄",
  dino: "🦕",
  octopus: "🐙",
} as const;

export type AvatarKey = keyof typeof AVATARS;
export const AVATAR_KEYS = Object.keys(AVATARS) as AvatarKey[];

export function avatarEmoji(key: string) {
  return AVATARS[key as AvatarKey] ?? AVATARS.fox;
}

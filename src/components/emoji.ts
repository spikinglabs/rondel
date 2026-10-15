const MAP: Record<string, string> = {
  rocket: '🚀', fire: '🔥', tada: '🎉', heart: '❤️', thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎',
  smile: '😄', sad: '😢', angry: '😠', thinking: '🤔', bug: '🐛', warning: '⚠️', star: '⭐', clap: '👏',
  eyes: '👀', bulb: '💡', check: '✅', x: '❌', coffee: '☕', snail: '🐌', zap: '⚡', muscle: '💪', pray: '🙏',
  100: '💯', party: '🥳', sweat: '😅', confused: '😕', trophy: '🏆', chart: '📈', lock: '🔒', calendar: '📅',
};

export function emojify(text: string) {
  return text.replace(/:([a-z0-9_+-]+):/g, (m, k) => MAP[k] ?? m);
}

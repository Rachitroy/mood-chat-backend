// Very lightweight, dependency-free emotion classifier.
// Scores a message against keyword/emoji lists per category and returns
// the highest-scoring tag. Swap this out later for an ML model or LLM
// call without touching anything else in the app — it's called from one
// place (sockets/chat.js) and always returns { tag, score }.

const CATEGORIES = {
  flirty: {
    keywords: [
      "cute", "beautiful", "handsome", "gorgeous", "crush", "date me",
      "miss you", "kiss", "xoxo", "babe", "cutie", "wink", "smooth",
    ],
    emojis: ["😘", "😍", "😏", "❤️", "💕", "💖", "😉", "🥰", "💋"],
    weight: 1,
  },
  angry: {
    keywords: [
      "angry", "furious", "hate", "stupid", "idiot", "shut up", "annoying",
      "screw this", "so mad", "pissed",
    ],
    emojis: ["😡", "🤬", "👿", "😠"],
    weight: 1,
  },
  sad: {
    keywords: [
      "sad", "depressed", "crying", "heartbroken", "lonely", "miss them",
      "hurts", "sorry for", "down", "upset",
    ],
    emojis: ["😢", "😭", "💔", "😞", "🥺"],
    weight: 1,
  },
  happy: {
    keywords: [
      "happy", "yay", "awesome", "great news", "excited", "love this",
      "amazing", "wonderful", "haha", "lol", "lmao",
    ],
    emojis: ["😄", "😂", "🎉", "🥳", "😁", "❤️", "🙌"],
    weight: 1,
  },
};

function scoreMessage(text) {
  const lower = text.toLowerCase();
  const scores = {};

  for (const [tag, def] of Object.entries(CATEGORIES)) {
    let score = 0;
    for (const kw of def.keywords) {
      if (lower.includes(kw)) score += def.weight;
    }
    for (const emoji of def.emojis) {
      if (text.includes(emoji)) score += def.weight;
    }
    // Extra punctuation signal for excitement/anger
    if ((tag === "happy" || tag === "angry") && /!{2,}/.test(text)) {
      score += 0.5;
    }
    scores[tag] = score;
  }

  return scores;
}

export function detectEmotion(text) {
  if (!text || typeof text !== "string") {
    return { tag: "neutral", score: 0 };
  }

  const scores = scoreMessage(text);
  let bestTag = "neutral";
  let bestScore = 0;

  for (const [tag, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestTag = tag;
    }
  }

  return { tag: bestTag, score: bestScore };
}

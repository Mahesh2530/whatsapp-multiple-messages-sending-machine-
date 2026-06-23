// ── Lazy AI client — only instantiated on first AI call ──────────
let aiClient = null;
let aiInitAttempted = false;

function getAIClient() {
  if (aiInitAttempted) return aiClient;
  aiInitAttempted = true;
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log('[SmartComposer] No GEMINI_API_KEY — using local rule-based engine.');
    return null;
  }
  try {
    const { GoogleGenAI } = require('@google/genai');
    aiClient = new GoogleGenAI({ apiKey: key });
    console.log('[SmartComposer] Gemini AI client initialised (enhanced mode).');
  } catch (e) {
    console.error('[SmartComposer] Failed to init Gemini:', e.message);
  }
  return aiClient;
}


// ════════════════════════════════════════════════════════════════
//  LOCAL RULE-BASED ENGINE  (works with zero API key)
// ════════════════════════════════════════════════════════════════

// ── Spelling / shorthand fixes ──────────────────────────────────
const SPELLING_FIXES = [
  // Greeting typos (fix BEFORE greeting detection)
  [/\bhellow\b/gi, 'Hello'],
  [/\bhelo\b/gi,   'Hello'],
  [/\bhey\b/gi,    'Hey'],

  // Common shorthand
  [/\bu\b/g,     'you'],
  [/\bur\b/g,    'your'],
  [/\br\b/g,     'are'],
  [/\bpls\b/gi,  'please'],
  [/\bplz\b/gi,  'please'],
  [/\bthx\b/gi,  'thanks'],
  [/\bty\b/gi,   'thank you'],
  [/\btmrw\b/gi, 'tomorrow'],
  [/\bnxt\b/gi,  'next'],
  [/\bmsg\b/gi,  'message'],
  [/\bmsgs\b/gi, 'messages'],
  [/\bcuz\b/gi,  'because'],
  [/\bbcoz\b/gi, 'because'],
  [/\bbcuz\b/gi, 'because'],
  [/\basap\b/gi, 'as soon as possible'],
  [/\bgr8\b/gi,  'great'],
  [/\bl8r\b/gi,  'later'],
  [/\bb4\b/gi,   'before'],

  // Common misspellings
  [/\balot\b/gi,        'a lot'],
  [/\brecieve\b/gi,     'receive'],
  [/\bseperate\b/gi,    'separate'],
  [/\bdefinately\b/gi,  'definitely'],
  [/\buntill\b/gi,      'until'],
  [/\boccured\b/gi,     'occurred'],
  [/\bwierd\b/gi,       'weird'],
  [/\bbeleive\b/gi,     'believe'],
  [/\bthier\b/gi,       'their'],
  [/\bwich\b/gi,        'which'],
  [/\bnoone\b/gi,       'no one'],
  [/\banyways\b/gi,     'anyway'],
  [/\bteh\b/g,          'the'],
  [/\badn\b/g,          'and'],
  [/\btommorow\b/gi,    'tomorrow'],
  [/\btommorrow\b/gi,   'tomorrow'],

  // Informal terms → standard
  [/\bwanna\b/gi,   'want to'],
  [/\bgonna\b/gi,   'going to'],
  [/\bgotta\b/gi,   'got to'],
  [/\bprolly\b/gi,  'probably'],
  [/\bdeffo\b/gi,   'definitely'],
  [/\bkinda\b/gi,   'kind of'],
  [/\bsorta\b/gi,   'sort of'],
  [/\boutta\b/gi,   'out of'],
  [/\blotta\b/gi,   'lot of'],
];

// ── Contractions → expanded (for formal/professional) ───────────
const CONTRACTIONS = [
  ["can't",    'cannot'],
  ["won't",    'will not'],
  ["don't",    'do not'],
  ["doesn't",  'does not'],
  ["didn't",   'did not'],
  ["isn't",    'is not'],
  ["aren't",   'are not'],
  ["wasn't",   'was not'],
  ["weren't",  'were not'],
  ["haven't",  'have not'],
  ["hasn't",   'has not'],
  ["hadn't",   'had not'],
  ["shouldn't",'should not'],
  ["wouldn't", 'would not'],
  ["couldn't", 'could not'],
  ["mustn't",  'must not'],
  ["I'm",      'I am'],
  ["you're",   'you are'],
  ["he's",     'he is'],
  ["she's",    'she is'],
  ["it's",     'it is'],
  ["we're",    'we are'],
  ["they're",  'they are'],
  ["I've",     'I have'],
  ["you've",   'you have'],
  ["we've",    'we have'],
  ["they've",  'they have'],
  ["I'll",     'I will'],
  ["you'll",   'you will'],
  ["he'll",    'he will'],
  ["she'll",   'she will'],
  ["we'll",    'we will'],
  ["they'll",  'they will'],
  ["I'd",      'I would'],
  ["you'd",    'you would'],
  ["he'd",     'he would'],
  ["she'd",    'she would'],
  ["we'd",     'we would'],
  ["they'd",   'they would'],
  ["that's",   'that is'],
  ["there's",  'there is'],
  ["what's",   'what is'],
  ["who's",    'who is'],
  ["let's",    'let us'],
  ["here's",   'here is'],
];

// ── Filler phrases to strip for Shorten ─────────────────────────
const FILLER_PHRASES = [
  [/I would like to inform you that\s*/gi, ''],
  [/Please be informed that\s*/gi,          ''],
  [/I am writing to (?:let you know|inform you) that\s*/gi, ''],
  [/I (?:just )?wanted to (?:reach out|write) (?:to|and)\s*/gi, ''],
  [/Just wanted to let you know that\s*/gi, ''],
  [/Feel free to\b/gi,               'Please'],
  [/In order to\b/gi,                'To'],
  [/At this point in time\b/gi,      'Now'],
  [/Due to the fact that\b/gi,       'Because'],
  [/In the event that\b/gi,          'If'],
  [/For the purpose of\b/gi,         'To'],
  [/With regard to\b/gi,             'About'],
  [/As a matter of fact[,\s]*/gi,    ''],
  [/It is important to note that\s*/gi, 'Note: '],
  [/Please do not hesitate to\b/gi,  'Please'],
  [/I hope this (?:email|message) finds you well\.?\s*/gi, ''],
  [/Kindly note that\s*/gi,          ''],
  [/\bthat being said[,\s]*/gi,      ''],
  [/\bat the end of the day[,\s]*/gi, 'Ultimately, '],
  // Redundant adverbs
  [/\bvery\s+very\b/gi, 'very'],
  [/\breally\s+really\b/gi, 'really'],
  [/\bbasically\b\s*/gi, ''],
  [/\bjust\b\s*/gi, ''],
];

// ── Safe formal word swaps (conservative — only clearly better substitutes) ─
const FORMAL_SWAPS = [
  [/\bfix\b/gi,       'resolve'],
  [/\bask\b/gi,       'inquire'],
  [/\bhelp\b/gi,      'assist'],
  [/\bbuy\b/gi,       'purchase'],
  [/\bstart\b/gi,     'initiate'],
  [/\bsoon\b(?!er)/gi,'promptly'],
];


// ── Core correction pass (applied before every tone mode) ────────
function applyBaseCorrections(text) {
  // 1. Fix 'i' standing alone → 'I'
  text = text.replace(/\bi\b/g, 'I');

  // 2. Spelling / shorthand (skip inside URLs)
  SPELLING_FIXES.forEach(([regex, replacement]) => {
    text = text.replace(regex, (match, offset) => {
      // Don't replace inside a URL
      const before = text.substring(Math.max(0, offset - 20), offset);
      if (/https?:\/\/\S*$/.test(before)) return match;
      return replacement;
    });
  });

  // 3. Collapse multiple spaces
  text = text.replace(/  +/g, ' ');

  // 4. Remove space before punctuation  "hello ." → "hello."
  text = text.replace(/ +([,;:!?.])/g, '$1');

  // 5. Ensure space after comma when not followed by space/digit/newline
  text = text.replace(/,([^\s\n\d])/g, ', $1');

  // 6. Capitalize first character of each sentence
  text = text.replace(/([.!?]\s+)([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase());

  // 7. Capitalize very first character
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  // 8. Trim trailing spaces per line
  text = text.split('\n').map(l => l.trimEnd()).join('\n');

  return text.trim();
}

// Helper — does the text start with a recognisable greeting?
function hasGreeting(text) {
  return /^(hi|hey|hello|dear|good morning|good afternoon|good evening|greetings|howdy|hiya)\b/i.test(text.trim());
}


// ── LOCAL: Grammar + spelling correction ─────────────────────────
function localCorrect(message) {
  const fixed = applyBaseCorrections(message);
  const changed = fixed !== message.trim();
  return {
    original: message,
    improved: fixed,
    explanation: changed
      ? 'Fixed spelling, shorthand, capitalization, and punctuation.'
      : 'No issues found — message looks good!',
  };
}


// ── LOCAL: Tone conversion ────────────────────────────────────────
function localChangeTone(message, tone) {
  // ALWAYS apply base corrections first so downstream logic
  // works on clean text (e.g. "hellow" → "Hello" before greeting check)
  let text = applyBaseCorrections(message);
  let explanation = '';

  // ── FORMAL ──────────────────────────────────────────────────────
  if (tone === 'Formal') {
    // Expand contractions
    CONTRACTIONS.forEach(([short, long]) => {
      const esc = short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['\u2019]");
      text = text.replace(new RegExp(`\\b${esc}\\b`, 'gi'), (m) => {
        // Preserve leading capital if original was capitalised
        return m[0] === m[0].toUpperCase() ? long.charAt(0).toUpperCase() + long.slice(1) : long;
      });
    });

    // Conservative formal swaps
    FORMAL_SWAPS.forEach(([regex, replacement]) => {
      text = text.replace(regex, (m, offset) => {
        const ctx = text.substring(Math.max(0, offset - 25), offset);
        if (/https?:\/\//.test(ctx)) return m;
        return m[0] === m[0].toUpperCase()
          ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
          : replacement;
      });
    });

    // Remove casual openers like "Hey!" if a proper greeting isn't needed
    text = text.replace(/^(hey!?\s*|hi!?\s*|howdy!?\s*)/i, '');

    // Strip emojis
    text = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/gu, '');

    // Re-apply base corrections after all changes
    text = applyBaseCorrections(text);
    explanation = 'Expanded contractions and replaced casual vocabulary with formal equivalents.';

  // ── PROFESSIONAL ─────────────────────────────────────────────────
  } else if (tone === 'Professional') {
    // Expand contractions (same as formal)
    CONTRACTIONS.forEach(([short, long]) => {
      const esc = short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['\u2019]");
      text = text.replace(new RegExp(`\\b${esc}\\b`, 'gi'), (m) =>
        m[0] === m[0].toUpperCase() ? long.charAt(0).toUpperCase() + long.slice(1) : long
      );
    });

    // Strip emojis
    text = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/gu, '');

    // Ensure it ends with a period
    text = text.replace(/([^.!?])\s*$/, '$1.');

    text = applyBaseCorrections(text);
    explanation = 'Adjusted to a clear, professional tone with expanded contractions and clean punctuation.';

  // ── FRIENDLY ─────────────────────────────────────────────────────
  } else if (tone === 'Friendly') {
    // Add greeting only if there isn't one already (checked AFTER base corrections)
    if (!hasGreeting(text)) {
      text = 'Hey! 👋 ' + text.charAt(0).toLowerCase() + text.slice(1);
      // Re-capitalize the text's own first word properly
      text = text.charAt(0).toUpperCase() + text.slice(1);
    } else {
      // Keep existing greeting, maybe add an emoji after it
      text = text.replace(/^(hi|hey|hello|dear|good morning|good afternoon|good evening)(!?),?\s*/i, (m) =>
        m.trimEnd() + (m.includes('👋') ? ' ' : ' 👋 ')
      );
    }

    // Warm up "thanks" → "thanks so much"  (only once, not on every word)
    text = text.replace(/\bthanks\b(?! so| a lot| again)/gi, 'thanks so much');
    text = text.replace(/\bthank you\b(?! so)/gi, 'thank you so much');

    // Friendly closing only if the message doesn't already end warmly
    const hasWarmClose = /[\u{1F300}-\u{1F9FF}]|cheers|take care|warm regards|best wishes/ui.test(text.slice(-40));
    if (!hasWarmClose) {
      text = text.trimEnd().replace(/[.!?]*$/, '') + ' 😊';
    }

    text = applyBaseCorrections(text);
    explanation = 'Added a warm greeting, softened the language, and gave the message a friendly tone.';

  // ── SHORTEN ──────────────────────────────────────────────────────
  } else if (tone === 'Shorten') {
    FILLER_PHRASES.forEach(([regex, replacement]) => {
      text = text.replace(regex, replacement);
    });
    text = text.replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    text = applyBaseCorrections(text);
    explanation = 'Removed filler phrases and redundant words. Message is now more concise.';

  // ── EXPAND ───────────────────────────────────────────────────────
  } else if (tone === 'Expand') {
    // Only expand if the message is genuinely short
    if (text.length < 250) {
      const alreadyHasClose = /please (?:let|do|feel|reach)|kindly|should you have/i.test(text);
      if (!alreadyHasClose) {
        text = text.trimEnd().replace(/[.!?]*$/, '.') +
          '\n\nPlease feel free to reach out if you have any questions or need further details. We are happy to help.';
      }
    }
    text = applyBaseCorrections(text);
    explanation = 'Expanded the message with additional context and a professional follow-up.';

  // ── REMINDER ─────────────────────────────────────────────────────
  } else if (tone === 'Reminder') {
    const hasReminderWord = /\b(reminder|remind|action required|deadline|follow.?up|overdue)\b/i.test(text);
    if (!hasReminderWord) {
      text = '⏰ *Reminder:* ' + text.charAt(0).toUpperCase() + text.slice(1);
    }
    const hasUrgency = /\b(today|by|before|deadline|urgent|asap|immediately)\b/i.test(text);
    if (!hasUrgency) {
      text = text.trimEnd().replace(/[.!?]*$/, '') + '.\n\nPlease action this at your earliest convenience.';
    }
    text = applyBaseCorrections(text);
    explanation = 'Added reminder framing and a polite urgency prompt.';
  }

  // Final cleanup
  text = text.replace(/ {2,}/g, ' ').trim();

  return {
    original: message,
    improved: text,
    explanation,
  };
}


// ── LOCAL: Improve structure + correctness ────────────────────────
function localImprove(message) {
  let text = applyBaseCorrections(message);

  // Break long single-paragraph wall-of-text into logical chunks
  if (!text.includes('\n') && text.length > 250) {
    text = text.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n\n');
  }

  // Format inline numbered lists onto their own lines
  text = text.replace(/(\s)(\d+\.\s)/g, '\n$2').trimStart();

  // Final pass
  text = applyBaseCorrections(text);

  return {
    original: message,
    improved: text.trim(),
    explanation: 'Fixed spelling, grammar, improved structure and readability for WhatsApp.',
  };
}


// ── LOCAL: Campaign quality reviewer ─────────────────────────────
function localReview(message) {
  const len = message.length;
  const strengths = [];
  const improvements = [];

  // Length
  if (len < 20)        improvements.push('Message is too short — add more context');
  else if (len > 800)  improvements.push('Message is very long — consider shortening for better read rates');
  else                 strengths.push('Good message length');

  // Spam risk
  const spamTerms = /\b(free!|winner|congratulations|urgent!|act now|limited time|click here|buy now|make money)\b/i;
  const hasSpam    = spamTerms.test(message);
  const capsRatio  = message.replace(/[^A-Z]/g, '').length / Math.max(message.replace(/[^a-zA-Z]/g, '').length, 1);
  const excessExcl = (message.match(/!/g) || []).length > 3;
  let spamRisk = 'Low';
  if (hasSpam) {
    spamRisk = 'High';
    improvements.push('Contains spam trigger words — rephrase to avoid delivery filters');
  } else if (capsRatio > 0.3 || excessExcl) {
    spamRisk = 'Medium';
    improvements.push('Excessive caps or exclamation marks may look spammy');
  } else {
    strengths.push('No spam trigger words detected');
  }

  // Personalization
  const hasVar = /\{\{(name|first_name|last_name)\}\}/i.test(message);
  if (hasVar) strengths.push('Personalisation variables used — great for 1-to-1 feel');
  else        improvements.push('Add {{name}} or {{first_name}} for a personal touch');

  // Readability
  const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 5);
  const avgWords  = sentences.reduce((a, s) => a + s.trim().split(/\s+/).length, 0) / Math.max(sentences.length, 1);
  let readability = 'High';
  if (avgWords > 25)      { readability = 'Low';    improvements.push('Sentences are long — aim for under 20 words'); }
  else if (avgWords > 15) { readability = 'Medium'; }
  else                    { strengths.push('Clear, scannable sentence length'); }

  // CTA
  const hasCTA = /\b(click|tap|visit|register|sign up|subscribe|reply|call|contact|check|join|book|order|learn more)\b/i.test(message);
  if (hasCTA) strengths.push('Clear call-to-action present');
  else        improvements.push('Add a clear CTA (e.g. "Reply YES", "Visit the link", "Register now")');

  // Emoji use
  const emojiCount = (message.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > 0 && emojiCount <= 4) strengths.push('Good emoji usage — adds visual engagement');
  else if (emojiCount > 5)              improvements.push('Too many emojis — limit to 3–4 for professionalism');

  // Greeting
  if (hasGreeting(message)) strengths.push('Message starts with a friendly greeting');

  // Heuristic score
  let score = 4;
  if (len >= 50 && len <= 500) score += 1;
  if (!hasSpam)                score += 1;
  if (!excessExcl)             score += 0.5;
  if (hasVar)                  score += 1;
  if (hasCTA)                  score += 1;
  if (readability === 'High')  score += 0.5;
  if (emojiCount > 0 && emojiCount <= 4) score += 0.5;
  if (hasGreeting(message))    score += 0.5;
  score = Math.min(10, Math.round(score));

  return {
    qualityScore: score,
    spamRisk,
    readability,
    personalization: hasVar ? 'Good' : 'Fair',
    strengths:    strengths.length    ? strengths    : ['Message is ready to send'],
    improvements: improvements.length ? improvements : ['Message looks great — no changes needed!'],
    engine: 'local',
  };
}


// ════════════════════════════════════════════════════════════════
//  GEMINI AI ENGINE  (enhanced when API key is set)
// ════════════════════════════════════════════════════════════════

async function aiGenerateStructured(prompt, original) {
  const client = getAIClient();
  if (!client) throw new Error('AI not configured');
  const finalPrompt = prompt + `
Return ONLY valid JSON with this structure:
{
  "original": ${JSON.stringify(original)},
  "improved": "<improved version>",
  "explanation": "<one-sentence summary of changes>"
}`;
  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: finalPrompt,
    config: { responseMimeType: 'application/json' },
  });
  return JSON.parse(response.text);
}


// ════════════════════════════════════════════════════════════════
//  PUBLIC API — local engine first, Gemini as upgrade
// ════════════════════════════════════════════════════════════════

async function correctMessage(message) {
  if (!getAIClient()) return localCorrect(message);
  try {
    return await aiGenerateStructured(
      `Fix only grammar, spelling, and punctuation for this WhatsApp message. Keep the tone and meaning identical.\nMessage: ${message}`,
      message
    );
  } catch (e) {
    console.warn('[SmartComposer] Gemini failed, using local engine:', e.message);
    return localCorrect(message);
  }
}

async function changeTone(message, tone) {
  if (!getAIClient()) return localChangeTone(message, tone);
  try {
    return await aiGenerateStructured(
      `Rewrite this WhatsApp message with a "${tone}" tone. Keep the core meaning.\nMessage: ${message}`,
      message
    );
  } catch (e) {
    console.warn('[SmartComposer] Gemini failed, using local engine:', e.message);
    return localChangeTone(message, tone);
  }
}

async function improveMessage(message) {
  if (!getAIClient()) return localImprove(message);
  try {
    return await aiGenerateStructured(
      `Improve this WhatsApp campaign message: fix grammar, improve structure, and make it more engaging while keeping the core intent.\nMessage: ${message}`,
      message
    );
  } catch (e) {
    console.warn('[SmartComposer] Gemini failed, using local engine:', e.message);
    return localImprove(message);
  }
}

async function reviewCampaign(message) {
  const client = getAIClient();
  if (!client) return localReview(message);
  try {
    const prompt = `Analyze this WhatsApp campaign message. Return ONLY valid JSON:
{
  "qualityScore": <0-10>,
  "spamRisk": "<Low|Medium|High>",
  "readability": "<Low|Medium|High>",
  "personalization": "<Poor|Fair|Good|Excellent>",
  "strengths": ["..."],
  "improvements": ["..."]
}
Message: ${message}`;
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    return JSON.parse(response.text);
  } catch (e) {
    console.warn('[SmartComposer] Gemini review failed, using local engine:', e.message);
    return localReview(message);
  }
}

module.exports = { correctMessage, changeTone, improveMessage, reviewCampaign };

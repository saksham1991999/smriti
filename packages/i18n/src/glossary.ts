/**
 * The Hindi UI vocabulary (R3: plain spoken Hindi with the English words students say, in
 * Devanagari). `preferred` is the loanword the onboarding doc fixes; `alternates` are the formal
 * words other docs still use. The docs leave the final choice open (onboarding flow Q2, §10), so
 * the lint reports mixed use instead of failing on it.
 */
export interface GlossaryEntry {
  en: string;
  preferred: string;
  alternates: readonly string[];
}

export const GLOSSARY_HI: readonly GlossaryEntry[] = [
  { en: 'lesson', preferred: 'लेसन', alternates: ['पाठ'] },
  { en: 'progress', preferred: 'प्रोग्रेस', alternates: ['प्रगति'] },
  { en: 'class', preferred: 'क्लास', alternates: ['कक्षा'] },
  { en: 'exam', preferred: 'एग्ज़ाम', alternates: ['परीक्षा'] },
  { en: 'level', preferred: 'लेवल', alternates: ['स्तर'] },
  { en: 'quiz', preferred: 'क्विज़', alternates: [] },
  { en: 'mock test', preferred: 'मॉक टेस्ट', alternates: [] },
  { en: 'streak', preferred: 'स्ट्रीक', alternates: [] },
  { en: 'reminder', preferred: 'रिमाइंडर', alternates: ['याद दिलाना'] },
  { en: 'settings', preferred: 'सेटिंग्स', alternates: [] },
  { en: 'topic', preferred: 'टॉपिक', alternates: ['विषय-वस्तु'] },
  { en: 'chapter', preferred: 'चैप्टर', alternates: ['अध्याय'] },
  { en: 'save', preferred: 'सेव', alternates: [] },
  { en: 'deep dive', preferred: 'डीप डाइव', alternates: [] },
  { en: 'quick revision', preferred: 'क्विक रिविज़न', alternates: [] },
  { en: 'freeze', preferred: 'फ़्रीज़', alternates: [] },
];

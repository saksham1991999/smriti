// Prop contracts for every DESIGN.md §5 component. ui-web and ui-native both implement exactly these
// props (plus `children` where a component takes content, and a platform style escape hatch), so a
// screen written for one platform reads the same on the other. Event props are named `on*Press`/`on*Change`
// on both platforms. All visible copy is passed in by the screen except the fixed strings in ./strings.
import type { ExamKey, MockPaletteState, Mode } from "../tokens";
import type { IconName } from "./icons";
import type { PetMood, PetSpecies, PlantHealth, PlantStage } from "./illustrations";
import type { KeypadKey, TimeResult, TimerMode } from "./logic";

/** A subject id from content ("phy", "economy") or a colour family ("physics"); resolved through subjectMap. */
export type SubjectRef = string;

export interface Action {
  label: string;
  onPress: () => void;
}

export interface BaseProps {
  testID?: string;
}

// ---------- Foundations ----------

export type TextVariant = "display" | "title" | "heading" | "body" | "label" | "caption";
export type TextTone = "ink" | "muted" | "disabled" | "primary" | "subject" | "onStrong" | "onPrimary" | "success" | "error" | "warning" | "streak";
export interface TextContract extends BaseProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Tabular figures for stats, timers and leaderboards (DESIGN.md §3). */
  numeric?: boolean;
  align?: "start" | "center" | "end";
  /** Subject for `tone="subject"`. */
  subject?: SubjectRef;
  /** Spoken as a heading (role heading / accessibilityRole header). */
  heading?: boolean;
}

export interface IconContract extends BaseProps {
  name: IconName;
  size?: 16 | 20 | 24 | 32;
  weight?: "bold" | "fill" | "regular";
  /** Colour token name; defaults to the current text colour. */
  color?: "ink" | "inkMuted" | "inkDisabled" | "primary" | "primaryText" | "onPrimary" | "streak" | "success" | "error" | "warning" | "successText" | "errorText" | "warningText" | "streakText" | "subjectStrong" | "subjectText" | "subjectOnStrong";
  /** Accessible label. Omit only when the icon is decorative (text next to it says the same). */
  label?: string;
}

export interface CardContract extends BaseProps {
  tone?: "surface" | "tint" | "strong" | "sunken";
  subject?: SubjectRef;
  size?: "md" | "lg";
  /** Outline instead of shadow (`line` border). */
  outlined?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export interface ThemeContract {
  mode?: Mode;
  exam?: ExamKey;
  locale?: "en" | "hi";
}

// ---------- Actions ----------

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export interface ButtonContract extends BaseProps {
  label: string;
  variant?: ButtonVariant;
  /** lg = 56 tall, sm = 40 tall (DESIGN.md §5). */
  size?: "lg" | "sm";
  icon?: IconName;
  iconPosition?: "start" | "end";
  loading?: boolean;
  disabled?: boolean;
  /** Defaults to true for lg, false for sm. */
  fullWidth?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export interface IconButtonContract extends BaseProps {
  icon: IconName;
  /** Required: icon-only buttons always have a label. */
  label: string;
  variant?: "plain" | "filled" | "primary";
  weight?: "bold" | "fill";
  disabled?: boolean;
  onPress?: () => void;
}

export interface GoogleButtonContract extends BaseProps {
  /** auto follows the colour mode (light theme / dark theme); neutral is for tinted grounds. */
  theme?: "auto" | "light" | "dark" | "neutral";
  text?: "continue" | "signIn";
  /** Padding set from thirdParty.google.padding. */
  platform?: "web" | "android" | "ios";
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

export interface AppleButtonContract extends BaseProps {
  /** auto: black in light mode, white in Night Colour. */
  appearance?: "auto" | "black" | "white" | "whiteOutline";
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

export type TrustLineContract = BaseProps;

// ---------- Learning cards ----------

export interface SubjectTileContract extends BaseProps {
  subject: SubjectRef;
  name: string;
  /** 0-1 */
  progress?: number;
  /** "21 chapters" */
  caption?: string;
  /** "Next: {topic_title}" */
  next?: string;
  illustration?: string;
  /** Optional status chip at the top (Free today, Needs internet, Pro). */
  chip?: { label: string; icon?: IconName; tone?: ChipTone };
  /** Needs internet: illustration dims to 60%, text stays full contrast. */
  offline?: boolean;
  onPress?: () => void;
}

export interface ContinueCardContract extends BaseProps {
  subject: SubjectRef;
  /** "Continue" kicker */
  eyebrow?: string;
  eyebrowIcon?: IconName;
  title: string;
  /** "Physics · 6 min left" */
  meta?: string;
  progress?: number;
  /** "62% done" next to the button */
  progressLabel?: string;
  illustration?: string;
  actionLabel?: string;
  onPress?: () => void;
}

export interface StreakCardContract extends BaseProps {
  /** One-line state copy from the screen ("One lesson waters it"). */
  message: string;
  goal?: { done: number; target: number; label?: string };
  freezes?: { ready: number; slots: number; label?: string };
  atRisk?: boolean;
  plant: { stage: PlantStage; health: PlantHealth; alt?: string };
  onPress?: () => void;
}

export interface StreakPillContract extends BaseProps {
  days: number;
  onPress?: () => void;
}

export type OptionState = "idle" | "selected" | "correct" | "wrong";
export interface OptionCardContract extends BaseProps {
  label: string;
  /** "A", "B" … for questions. */
  keyLabel?: string;
  state?: OptionState;
  /** question: A/B/C/D answer; choice: onboarding and settings card with the CheckCircle badge. */
  kind?: "question" | "choice";
  /** Checkbox semantics instead of radio. */
  multiple?: boolean;
  description?: string;
  illustration?: string;
  disabled?: boolean;
  onPress?: () => void;
}

export type Confidence = "sure" | "half" | "guess";
export interface ConfidenceRowContract extends BaseProps {
  value: Confidence | null;
  onChange: (v: Confidence | null) => void;
  /** Show the "How sure are you? (optional)" label above. */
  showLabel?: boolean;
  disabled?: boolean;
}

export type Rating = "again" | "hard" | "good" | "easy";
export interface RatingButtonsContract extends BaseProps {
  /** Next interval per rating, already formatted ("10 min", "2 d"). */
  intervals: Record<Rating, string>;
  onRate: (r: Rating) => void;
  /** grid = 2 x 2, used at large text sizes. */
  layout?: "row" | "grid";
  disabled?: boolean;
}

export type ProgressTone = "subject" | "primary" | "streak" | "success" | "gem" | "onStrong";
export interface ProgressBarContract extends BaseProps {
  /** 0-1 */
  value: number;
  tone?: ProgressTone;
  subject?: SubjectRef;
  /** Accessible name ("Daily goal"). */
  label: string;
  valueText?: string;
  /** 8 (default) or 10 (Meter). */
  thickness?: 8 | 10;
}

export interface ProgressRingContract extends BaseProps {
  value: number;
  size?: number;
  /** 10-12 (DESIGN.md §5). */
  stroke?: number;
  tone?: ProgressTone;
  subject?: SubjectRef;
  label: string;
  valueText?: string;
  /** Text in the middle ("62%"). */
  centerText?: string;
}

export interface SegmentedProgressContract extends BaseProps {
  total: number;
  done: number;
  /** Index of the segment in progress (shown half filled). */
  current?: number;
  tone?: ProgressTone;
  subject?: SubjectRef;
  label: string;
}

export type ChipTone = "neutral" | "subject" | "primary" | "success" | "warning" | "error" | "streak" | "sunken";
export interface ChipContract extends BaseProps {
  label: string;
  /** filter: selectable on surfaceRaised; status: tint with its *Text colour. */
  kind?: "filter" | "status";
  tone?: ChipTone;
  icon?: IconName;
  selected?: boolean;
  subject?: SubjectRef;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export interface ChoiceChipsContract extends BaseProps {
  /** Group label, spoken and shown. */
  label: string;
  hideLabel?: boolean;
  options: { value: string; label: string }[];
  value: string[];
  multiple?: boolean;
  onChange: (value: string[]) => void;
}

export interface PickerContract extends BaseProps {
  label: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
}

export interface SwitchContract extends BaseProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

// ---------- Containers ----------

export type SheetHeight = "40" | "60" | "full";
export interface SheetContract extends BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  hideTitle?: boolean;
  description?: string;
  height?: SheetHeight;
  tone?: "default" | "success" | "error";
  /** Can be dismissed by swipe, scrim tap and Escape (default true). */
  dismissible?: boolean;
}

export interface DialogContract extends BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirm?: Action & { destructive?: boolean };
  cancel?: Action;
}

export interface TooltipContract extends BaseProps {
  label: string;
}

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  badge?: string;
}
export interface TabBarContract extends BaseProps {
  items: NavItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}
export type SidebarNavContract = TabBarContract;

export interface TopBarContract extends BaseProps {
  title?: string;
  onBack?: () => void;
  backIcon?: "CaretLeft" | "X";
  actions?: { icon: IconName; label: string; onPress: () => void }[];
}

export interface BannerContract extends BaseProps {
  tone: "info" | "warning" | "offline";
  text: string;
  icon?: IconName;
  action?: Action;
  onClose?: () => void;
}

export interface ToastContract extends BaseProps {
  open: boolean;
  message: string;
  /** error toasts stay until dismissed (DESIGN.md §5). */
  tone?: "default" | "error";
  icon?: IconName;
  action?: Action;
  onDismiss: () => void;
  /** Default 4000 ms; ignored for errors. */
  durationMs?: number;
}

export interface EmptyStateContract extends BaseProps {
  illustration?: string;
  pet?: { species: PetSpecies; mood?: PetMood };
  plant?: { stage: PlantStage; health: PlantHealth };
  alt?: string;
  text: string;
  action?: Action;
}

export interface SettingsRowContract extends BaseProps {
  title: string;
  icon?: IconName;
  value?: string;
  trailing?: "caret" | "switch" | "none";
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface SettingsGroupContract extends BaseProps {
  title?: string;
}

// ---------- Pet and plant ----------

export interface IllustrationContract extends BaseProps {
  /** File name without extension, e.g. "subject-physics". */
  name: string;
  /** Names to try if the first is missing. */
  fallback?: string[];
  /** Alt text. When omitted the provider's lookup is used, else the image is decorative. */
  alt?: string;
  decorative?: boolean;
  width?: number;
  height?: number;
  fit?: "contain" | "cover";
  /** Dim to 60% (offline). */
  dimmed?: boolean;
}

export interface PetViewContract extends BaseProps {
  species: PetSpecies;
  mood?: PetMood;
  under10?: boolean;
  size?: number;
  alt?: string;
  decorative?: boolean;
}

export interface PlantViewContract extends BaseProps {
  stage: PlantStage;
  health?: PlantHealth;
  size?: number;
  alt?: string;
  decorative?: boolean;
}

export interface PetAvatarContract extends BaseProps {
  species: PetSpecies;
  mood?: PetMood;
  /** 32, 40 (Pet line) or 88 (profile). */
  size?: number;
  alt?: string;
}

export interface PetLineContract extends BaseProps {
  pet: { species: PetSpecies; mood?: PetMood };
  petName: string;
  text: string;
  avatarSize?: 32 | 40;
  /** Announce politely when the text changes. */
  live?: boolean;
}

// ---------- Stats and status ----------

export interface StatTileContract extends BaseProps {
  value: string;
  label: string;
  tint?: boolean;
  subject?: SubjectRef;
  icon?: IconName;
}

export interface MeterContract extends BaseProps {
  kind: "mood" | "energy";
  label: string;
  stateWord: string;
  /** 0-100 */
  value: number;
}

export type DayState = "done" | "today" | "todo";
export interface DayDotsContract extends BaseProps {
  days: { label: string; state: DayState }[];
  label: string;
}

export type SaveState = "guest" | "saving" | "saved" | "saved_offline";
export interface SaveStateChipContract extends BaseProps {
  state: SaveState;
  email?: string;
  /** Apple sign-in never shows the email (it may be a private relay). */
  provider?: "google" | "apple";
  /** Managed child: "Saved by your grown-up". */
  managed?: boolean;
  layout?: "chip" | "row";
  onPress?: () => void;
}

export interface PriceBlockContract extends BaseProps {
  /** Live text from the store or server, never an image ("₹1"). */
  price: string;
  thenLine?: string;
  finePrint?: string;
}

export interface TrialTimelineContract extends BaseProps {
  eligible: boolean;
  /** Formatted by the screen from the store's or Razorpay's real period. */
  todayLabel?: string;
  reminderDate: string;
  renewDate: string;
  trialPrice: string;
  renewPrice: string;
}

export interface ProChipContract extends BaseProps {
  /** Under-13s see "Ask a grown-up" and never a price (R14). */
  askGrownUp?: boolean;
  onPress?: () => void;
}

export interface LimitMeterContract extends BaseProps {
  label: string;
  used: number;
  limit: number;
  /** How many remaining counts as "last few". */
  lastFewAt?: number;
  proAction?: "pro_link" | "ask_grown_up" | "none";
  onProPress?: () => void;
  /** Pro students see no meter. */
  hidden?: boolean;
}

export interface CitationChipContract extends BaseProps {
  examShort: string;
  year: string | number;
  sessionLabel: string;
  keyStatus?: "final" | "provisional" | "dropped" | "changed";
  onPress?: () => void;
}

// ---------- Practice and mocks ----------

export interface MockPaletteCellContract extends BaseProps {
  number: number;
  state: MockPaletteState;
  current?: boolean;
  onPress?: () => void;
}

export interface TimerContract extends BaseProps {
  mode: TimerMode;
  endsAt?: number;
  startedAt?: number;
  /** Server-offset clock; defaults to Date.now. */
  now?: () => number;
  warnAtMs?: number;
  finalAtMs?: number;
  paused?: boolean;
  pausedMs?: number;
  sectional?: { label: string; endsAt: number };
  announce?: "warnings" | "none";
  size?: "header" | "compact";
  /** Caption under the digits ("Time left"); defaults to the fixed string. */
  caption?: string;
  hideCaption?: boolean;
}

export interface SectionTab {
  code: string;
  title: string;
  answered: number;
  total: number;
  state: "open" | "locked" | "not_open";
}
export interface SectionTabsContract extends BaseProps {
  sections: SectionTab[];
  activeCode: string;
  onSelect: (code: string) => void;
  navigation?: "free" | "locked_in_order" | "free_within_timer";
  label?: string;
}

export interface NumericKeypadContract extends BaseProps {
  value: string;
  onChange: (value: string) => void;
  allowDecimal?: boolean;
  allowNegative?: boolean;
  maxLength?: number;
  format?: "integer" | "decimal";
  hardwareKeys?: boolean;
  disabled?: boolean;
  /** Shown under the field with an icon. */
  error?: string;
  label?: string;
  onKey?: (key: KeypadKey) => void;
}

export interface OmrBubbleRowContract extends BaseProps {
  questionNo: number;
  /** "1"-"4" or "A"-"D". */
  options: string[];
  selected?: number | null;
  flagged?: boolean;
  onSelect?: (index: number) => void;
  onClear?: () => void;
  readOnly?: boolean;
}

export interface ScoreRingContract extends BaseProps {
  score: number;
  max: number;
  label?: string;
  size?: "lg" | "md";
  animate?: boolean;
  loading?: boolean;
}

export interface HeatMapCellContract extends BaseProps {
  /** Percent right, 0-100, or null when unknown. */
  value: number | null;
  count: number;
  minCount: number;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

export interface TimeStripItem {
  questionNo: number;
  sectionCode?: string;
  timeMs: number;
  targetMs?: number;
  result: TimeResult;
}
export interface TimeStripContract extends BaseProps {
  items: TimeStripItem[];
  label: string;
  /** Bar colour family (the section's subject). */
  subject?: SubjectRef;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  showTarget?: boolean;
  /** Caption naming where the target comes from (MOCK-19). */
  targetCaption?: string;
  view?: "chart" | "table";
  onViewChange?: (view: "chart" | "table") => void;
}

export interface LeaderboardRowContract extends BaseProps {
  rank: number | null;
  /** Pet avatar for students (always for minors), initials only where a spec says so. */
  avatar: { kind: "pet"; species: PetSpecies } | { kind: "initials"; initials: string };
  /** Already resolved by app-core privacy rules. The component never receives a minor's real or typed name. */
  name: string;
  score: string;
  time?: string;
  percentile?: string;
  isSelf?: boolean;
  pinned?: boolean;
  /** rank: null shows "Rank soon" when pending, else "Not ranked". */
  rankPending?: boolean;
  onPress?: () => void;
}

export interface FormulaBoxContract extends BaseProps {
  /** KaTeX source; web renders it with KaTeX. */
  latex: string;
  /** Pre-rendered KaTeX SVG from the content bundle (required on native). */
  svg?: string;
  subject?: SubjectRef;
  /** Spoken form of the formula. */
  label: string;
  symbols?: { id: string; label: string }[];
  onSymbolPress?: (id: string) => void;
  inVault?: boolean;
  onAddToVault?: () => void;
}

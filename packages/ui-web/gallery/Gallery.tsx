import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Mode } from "@smriti/tokens";
import {
  AppleButton,
  Banner,
  Button,
  ChatBubble,
  ChatInput,
  CheerButton,
  CitationChip,
  Chip,
  ChoiceChips,
  ConfidenceRow,
  ContinueCard,
  DayDots,
  DuelScoreBar,
  Dialog,
  EmptyState,
  FormulaBox,
  FriendRow,
  GoogleButton,
  HeatMapCell,
  Icon,
  IconButton,
  Illustration,
  LeaderboardRow,
  LeagueTierBadge,
  LimitMeter,
  Meter,
  MockPaletteCell,
  NumericKeypad,
  OmrBubbleRow,
  OptionCard,
  PetAvatar,
  PetLine,
  PetView,
  Picker,
  PlantView,
  PriceBlock,
  ProChip,
  ProgressBar,
  ProgressRing,
  RatingButtons,
  RoomCard,
  SaveStateChip,
  ScoreRing,
  SectionTabs,
  SegmentedProgress,
  SettingsGroup,
  SettingsRow,
  Sheet,
  SidebarNav,
  SquadCard,
  StatTile,
  StreakCard,
  StreakPill,
  SubjectTile,
  Switch,
  TabBar,
  Text,
  ThemeScope,
  TimeStrip,
  Timer,
  Toast,
  Tooltip,
  TooltipProvider,
  TopBar,
  TrialTimeline,
  TrustLine,
  UIProvider,
  type Confidence,
  type Locale,
  type NavItem,
} from "../src";
import { galleryCopy, type GalleryCopy } from "./copy";

interface Env {
  mode: Mode;
  locale: Locale;
}

type Render = (c: GalleryCopy, env: Env) => ReactNode;

const navIcons = ["House", "Flask", "Exam", "UsersThree", "UserCircle"] as const;
const navItems = (c: GalleryCopy, n: 3 | 4 | 5): NavItem[] => {
  const all = c.tabs.map((label, i) => ({ key: String(i), label, icon: navIcons[i] ?? "House" }));
  if (n === 5) return all;
  if (n === 4) return all.filter((_, i) => i !== 3);
  return all.filter((_, i) => i === 0 || i === 1 || i === 4);
};

function Stack({ children, gap = 3, className }: { children: ReactNode; gap?: 2 | 3 | 4; className?: string }) {
  return <div className={`flex flex-col ${gap === 2 ? "gap-2" : gap === 4 ? "gap-4" : "gap-3"} ${className ?? ""}`}>{children}</div>;
}
function Row({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  return <div className={`flex items-center gap-3 ${wrap ? "flex-wrap" : ""}`}>{children}</div>;
}
function Label({ children }: { children: ReactNode }) {
  return <span className="text-caption text-ink-muted">{children}</span>;
}

// Interactive demos keep their own state per pane.
function OptionsDemo({ c }: { c: GalleryCopy }) {
  const [sel, setSel] = useState<string | null>("B");
  const [conf, setConf] = useState<Confidence | null>("half");
  return (
    <Stack>
      <div role="radiogroup" aria-label="Options" className="flex flex-col gap-2">
        {["A", "B", "C", "D"].map((k) => (
          <OptionCard key={k} keyLabel={k} label={c.option(k)} state={sel === k ? "selected" : "idle"} onPress={() => setSel(k)} />
        ))}
      </div>
      <ConfidenceRow value={conf} onChange={setConf} />
      <Button label={c.check} disabled={sel === null} />
    </Stack>
  );
}

function ChoiceDemo({ c }: { c: GalleryCopy }) {
  const [goal, setGoal] = useState<string[]>(["10"]);
  return <ChoiceChips label={c.goalGroup} options={c.goalOptions.map((l, i) => ({ value: String([5, 10, 20, 30][i]), label: l }))} value={goal} onChange={setGoal} />;
}

function FormDemo({ c }: { c: GalleryCopy }) {
  const [year, setYear] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>("2");
  const [sound, setSound] = useState(true);
  return (
    <Stack>
      <div className="grid grid-cols-2 gap-3">
        <Picker label={c.monthLabel} value={month} onChange={setMonth} options={c.months.map((m, i) => ({ value: String(i + 1), label: m }))} />
        <Picker label={c.yearLabel} value={year} onChange={setYear} options={["2010", "2011", "2012", "2013"].map((y) => ({ value: y, label: y }))} />
      </div>
      <SettingsGroup title={c.settingsLearning}>
        <SettingsRow icon="Sliders" title={c.studyPrefs} value={c.studyPrefsValue} onPress={() => undefined} />
        <SettingsRow icon="Bell" title={c.notifications} value={c.notificationsValue} onPress={() => undefined} />
        <SettingsRow icon="SpeakerHigh" title={c.sound} trailing="switch" checked={sound} onCheckedChange={setSound} />
        <SettingsRow icon="SignOut" title={c.signOut} destructive trailing="none" onPress={() => undefined} />
      </SettingsGroup>
      <Switch label={c.darkMode} checked={!sound} onCheckedChange={(v) => setSound(!v)} />
    </Stack>
  );
}

function KeypadDemo() {
  const [v, setV] = useState("-12.5");
  return <NumericKeypad value={v} onChange={setV} hardwareKeys={false} />;
}

function OmrDemo() {
  const [a, setA] = useState<number | null>(1);
  const [b, setB] = useState<number | null>(null);
  return (
    <Stack gap={2}>
      <OmrBubbleRow questionNo={12} options={["1", "2", "3", "4"]} selected={a} onSelect={setA} onClear={() => setA(null)} />
      <OmrBubbleRow questionNo={13} options={["A", "B", "C", "D"]} selected={b} onSelect={setB} flagged />
    </Stack>
  );
}

function TabsDemo({ c }: { c: GalleryCopy }) {
  const [active, setActive] = useState("p");
  return (
    <SectionTabs
      label={c.tabsLabel}
      activeCode={active}
      onSelect={setActive}
      sections={[
        { code: "p", title: c.sections[0] ?? "", answered: 6, total: 25, state: "open" },
        { code: "c", title: c.sections[1] ?? "", answered: 0, total: 25, state: "open" },
        { code: "m", title: c.sections[2] ?? "", answered: 0, total: 25, state: "locked" },
      ]}
    />
  );
}

function OverlayDemo({ c }: { c: GalleryCopy }) {
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [toast, setToast] = useState(true);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return (
    <Stack>
      <div ref={setPortal} />
      <Row>
        <Button size="sm" variant="secondary" label={c.openSheet} onPress={() => setSheet(true)} />
        <Button size="sm" variant="secondary" label={c.openDialog} onPress={() => setDialog(true)} />
        <Tooltip label={c.tooltip}>
          <IconButton icon="DotsThreeVertical" label={c.tooltip} variant="filled" />
        </Tooltip>
      </Row>
      <Toast open={toast} message={c.toast} icon="CheckCircle" action={{ label: c.undo, onPress: () => setToast(false) }} onDismiss={() => setToast(false)} durationMs={600000} />
      <Toast open message={c.toastErr} tone="error" action={{ label: c.retry, onPress: () => undefined }} onDismiss={() => undefined} />
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        portalContainer={portal}
        title={c.sheetTitle}
        description={c.sheetBody}
        height="60"
        footer={
          <>
            <GoogleButton />
            <Button label={c.later} variant="secondary" onPress={() => setSheet(false)} />
            <TrustLine />
          </>
        }
      >
        <PetLine pet={{ species: "cat", mood: "happy" }} petName={c.petName} text={c.petLineTip} />
      </Sheet>
      <Dialog portalContainer={portal} open={dialog} onOpenChange={setDialog} title={c.dialogTitle} description={c.dialogBody} confirm={{ label: c.signOut, onPress: () => setDialog(false) }} cancel={{ label: c.cancel, onPress: () => setDialog(false) }} />
    </Stack>
  );
}

function NavDemo({ c }: { c: GalleryCopy }) {
  const [tab, setTab] = useState("0");
  return (
    <Stack>
      <div className="overflow-hidden rounded-card bg-bg ring-1 ring-line">
        <TopBar title={c.screenTitle} onBack={() => undefined} actions={[{ icon: "MagnifyingGlass", label: c.search, onPress: () => undefined }]} />
        <TabBar items={navItems(c, 5)} activeKey={tab} onSelect={setTab} />
      </div>
      <Label>Phase 1 (4 tabs) · little learners (3 tabs)</Label>
      <div className="overflow-hidden rounded-card ring-1 ring-line">
        <TabBar items={navItems(c, 4)} activeKey={tab} onSelect={setTab} />
      </div>
      <div className="overflow-hidden rounded-card ring-1 ring-line">
        <TabBar items={navItems(c, 3)} activeKey={tab === "3" || tab === "2" ? "0" : tab} onSelect={setTab} />
      </div>
      <div className="h-72 overflow-hidden rounded-card ring-1 ring-line">
        <SidebarNav
          items={navItems(c, 4)}
          activeKey={tab}
          onSelect={setTab}
          className="h-full"
          header={
            <div className="mb-2 flex items-center gap-2 rounded-md bg-streak-tint p-2">
              <PlantView stage="sapling" size={40} decorative />
              <StreakPill days={12} />
            </div>
          }
        />
      </div>
    </Stack>
  );
}

function TimeStripDemo({ c }: { c: GalleryCopy }) {
  const [sel, setSel] = useState(6);
  const times = [95, 140, 50, 210, 70, 120, 400, 85, 160, 40, 250, 115];
  const results = ["right", "right", "wrong", "right", "skipped", "right", "wrong", "right", "right", "wrong", "right", "skipped"] as const;
  return (
    <TimeStrip
      label={c.timeStrip}
      subject="physics"
      selectedIndex={sel}
      onSelect={setSel}
      targetCaption={c.targetCaption}
      items={times.map((s, i) => ({ questionNo: i + 1, timeMs: s * 1000, targetMs: 150_000, result: results[i] ?? "right" }))}
    />
  );
}


function ChatDemo({ c }: { c: GalleryCopy }) {
  const [value, setValue] = useState(c.chatDraft);
  const [streaming, setStreaming] = useState(false);
  return (
    <Stack>
      <div className="flex flex-col gap-3 rounded-card bg-bg p-3 ring-1 ring-line">
        <ChatBubble role="system" text={c.chatSystem} />
        <ChatBubble role="student" text={c.chatStudent} />
        <ChatBubble
          role="tutor"
          authorName={c.petName}
          avatar={{ species: "cat" }}
          text={c.chatTutor}
          citations={<CitationChip examShort="JEE Main" year={2025} sessionLabel="Jan S1" onPress={() => undefined} />}
          actions={
            <>
              <IconButton icon="SpeakerHigh" label={c.petName} size={40} onPress={() => undefined} />
              <IconButton icon="Cards" label={c.petName} size={40} onPress={() => undefined} />
            </>
          }
        />
        <ChatBubble role="tutor" authorName={c.petName} avatar={{ species: "cat", mood: "thinking" }} streaming />
        <ChatBubble role="tutor" authorName={c.petName} text={c.chatPartial} stopped />
      </div>
      <div className="overflow-hidden rounded-card ring-1 ring-line">
        <ChatInput
          value={value}
          onChange={setValue}
          onSend={() => setStreaming(true)}
          onStop={() => setStreaming(false)}
          streaming={streaming}
          label={c.chatLabel}
          placeholder={c.chatPlaceholder}
          maxLength={60}
          attach={<IconButton icon="Plus" label={c.chatLabel} size={48} onPress={() => undefined} />}
        />
      </div>
      <div className="overflow-hidden rounded-card ring-1 ring-line">
        <ChatInput value="" onChange={() => undefined} onSend={() => undefined} label={c.chatLabel} placeholder={c.chatPlaceholder} disabled />
      </div>
    </Stack>
  );
}

function SocialDemo({ c }: { c: GalleryCopy }) {
  const [picked, setPicked] = useState(1);
  const [cheered, setCheered] = useState<number[]>([1]);
  const icons = ["HandsClapping", "Star", "Barbell", "Smiley"] as const;
  const msgIcons = ["UsersThree", "Plant", "Sparkle", "Lightning"] as const;
  return (
    <Stack>
      <div className="flex flex-col rounded-card bg-surface py-1 shadow-card">
        <FriendRow name={c.friends[0] ?? ""} avatar={{ species: "dog" }} studiedToday streakDays={12} />
        <FriendRow name={c.friends[1] ?? ""} avatar={{ species: "cat", mood: "curious" }} studiedToday={false} streakDays={3} />
        <FriendRow name={c.friends[2] ?? ""} avatar={{ species: "dog", mood: "happy" }} studyingNow />
      </div>
      <Label>SOC-15 pick a friend</Label>
      <div role="radiogroup" className="flex flex-col rounded-card bg-surface py-1 shadow-card">
        {c.friends.map((f, i) => (
          <FriendRow key={f} name={f} avatar={{ species: i % 2 ? "cat" : "dog" }} selectable selected={picked === i} disabled={i === 2} note={i === 2 ? c.friendNote : undefined} onPress={() => setPicked(i)} />
        ))}
      </div>
      <Row>
        {c.tiers.map((tier, i) => (
          <LeagueTierBadge key={tier.crest} name={tier.name} crest={tier.crest} state={i === 0 ? "past" : i === 1 ? "current" : "future"} size="md" />
        ))}
        <LeagueTierBadge name={c.tiers[1]?.name ?? ""} crest={c.tiers[1]?.crest ?? ""} size="lg" showName={false} />
      </Row>
      <DuelScoreBar
        count={7}
        you={{ name: c.you, avatar: { species: "cat" }, score: 40, answers: ["right", "right", "wrong", "right", "answered"] }}
        opponent={{ name: c.friends[1] ?? "", avatar: { species: "dog" }, score: 30, answers: ["right", "wrong", "right", "answered"] }}
      />
      <DuelScoreBar count={7} you={{ name: c.you, avatar: { species: "cat" }, score: 10, answers: ["right", "open"] }} opponent={{ name: c.friends[0] ?? "", avatar: { species: "dog" }, score: 0, answers: ["answered"], dropped: true }} />
      <DuelScoreBar count={7} you={{ name: c.you, avatar: { species: "cat" }, score: 20, answers: ["right", "right", "answered"] }} />
      {c.squads.map((sq, i) => (
        <SquadCard key={sq.crest} name={sq.name} crest={sq.crest} done={i ? 400 : 240} target={400} daysLeft={i ? undefined : 3} onPress={() => undefined} />
      ))}
      <Row>
        {c.reactions.map((r, i) => (
          <CheerButton key={r} label={r} icon={icons[i] ?? "Star"} count={[3, 5, 1, 0][i]} sent={cheered.includes(i)} onPress={() => setCheered((x) => [...x, i])} />
        ))}
      </Row>
      <div className="grid grid-cols-2 gap-2">
        {c.cheerMessages.map((m, i) => (
          <CheerButton key={m} kind="message" label={m} icon={msgIcons[i] ?? "Star"} sent={i === 1} disabled={i === 3} onPress={() => undefined} />
        ))}
      </div>
    </Stack>
  );
}

const T0 = Date.UTC(2026, 9, 29, 10, 0, 0);

const sections: { id: string; title: string; render: Render }[] = [
  {
    id: "type",
    title: "Type and colour",
    render: (c) => (
      <Stack gap={2}>
        <Text variant="display">{c.sheetTitle}</Text>
        <Text variant="title">{c.screenTitle}</Text>
        <Text variant="heading">{c.physics}</Text>
        <Text variant="body">{c.sheetBody}</Text>
        <Text variant="label">{c.studyPrefs}</Text>
        <Text variant="caption" tone="muted">
          {c.chapters21}
        </Text>
        <div className="mt-2 grid grid-cols-7 gap-1.5">
          {(["physics", "chemistry", "biology", "maths", "history", "polity", "language"] as const).map((s) => (
            <div key={s} data-subject={s} className="flex flex-col gap-1">
              <span className="h-7 rounded-xs bg-subject-tint" />
              <span className="h-7 rounded-xs bg-subject-strong" />
            </div>
          ))}
        </div>
        <Row>
          {(["Plant", "Snowflake", "Lightbulb", "Exam", "Flask", "LockSimple", "CloudCheck", "Timer"] as const).map((n) => (
            <Icon key={n} name={n} weight={n === "Plant" ? "fill" : "bold"} color={n === "Plant" ? "streak" : "ink"} label={n} />
          ))}
        </Row>
      </Stack>
    ),
  },
  {
    id: "buttons",
    title: "Button",
    render: (c) => (
      <Stack>
        <Button label={c.start} />
        <Button label={c.later} variant="secondary" />
        <Button label={c.small} variant="ghost" />
        <Button label={c.delete} variant="destructive" icon="Trash" />
        <Button label={c.check} disabled />
        <Button label={c.check} loading />
        <Row>
          <Button size="sm" label={c.small} icon="ArrowRight" iconPosition="end" />
          <Button size="sm" variant="secondary" label={c.later} />
          <IconButton icon="MagnifyingGlass" label={c.search} />
          <IconButton icon="X" label="Close" variant="filled" />
        </Row>
      </Stack>
    ),
  },
  {
    id: "signin",
    title: "Third-party sign-in (brand exception)",
    render: () => (
      <Stack>
        <GoogleButton />
        <AppleButton />
        <TrustLine />
        <Label>Neutral theme on a tinted ground · loading</Label>
        <div className="flex flex-col gap-3 rounded-card bg-primary-tint p-3">
          <GoogleButton theme="neutral" text="signIn" />
          <GoogleButton loading />
        </div>
      </Stack>
    ),
  },
  {
    id: "pet",
    title: "Pet line, pet and plant",
    render: (c) => (
      <Stack>
        <PetLine pet={{ species: "cat", mood: "happy" }} petName={c.petName} text={c.petLine} />
        <PetLine pet={{ species: "dog", mood: "curious" }} petName={c.petName} text={c.petLineTip} avatarSize={32} />
        <Row>
          <PetView species="cat" mood="excited" size={96} />
          <PetView species="dog" mood="thinking" size={96} />
          <PetView species="cat" mood="resting" size={96} />
          <PetAvatar species="dog" size={40} />
          <PetAvatar species="cat" size={40} />
        </Row>
        <Label>Stages: seed → tree · sapling health: droopy, dry, wilted, resting</Label>
        <Row wrap={false}>
          {(["seed", "sprout", "sapling", "flowering", "tree"] as const).map((s) => (
            <PlantView key={s} stage={s} size={60} />
          ))}
        </Row>
        <Row wrap={false}>
          {(["droopy", "dry", "wilted", "dormant"] as const).map((h) => (
            <PlantView key={h} stage="sapling" health={h} size={60} />
          ))}
          <Illustration name="subject-chemistry" width={60} height={60} />
        </Row>
      </Stack>
    ),
  },
  {
    id: "streak",
    title: "Streak pill and Streak card",
    render: (c) => (
      <Stack>
        <Row>
          <StreakPill days={12} />
          <StreakPill days={248} onPress={() => undefined} />
        </Row>
        <StreakCard message={c.streakMsg} goal={{ done: 4, target: 10 }} freezes={{ ready: 2, slots: 2 }} plant={{ stage: "sapling", health: "thriving" }} />
        <StreakCard message={c.streakRisk} atRisk goal={{ done: 0, target: 10 }} freezes={{ ready: 1, slots: 2 }} plant={{ stage: "sapling", health: "droopy" }} />
      </Stack>
    ),
  },
  {
    id: "learning",
    title: "Subject tile and Continue card",
    render: (c) => (
      <Stack>
        <ContinueCard subject="phy" eyebrow={c.continue} title={c.topicTitle} meta={c.continueMeta} progress={0.62} progressLabel={c.percentDone} illustration="subject-physics" onPress={() => undefined} />
        <div className="grid grid-cols-2 gap-3 pt-3">
          <SubjectTile subject="phy" name={c.physics} next={c.nextTopic} progress={0.34} caption={c.chapters21} illustration="subject-physics" onPress={() => undefined} />
          <SubjectTile subject="chem" name={c.chemistry} next={c.nextTopic} progress={0.18} caption={c.chapters20} illustration="subject-chemistry" chip={{ label: c.freeToday, icon: "Gift" }} onPress={() => undefined} />
          <SubjectTile subject="math" name={c.maths} progress={0.09} caption={c.chapters25} illustration="subject-maths" onPress={() => undefined} />
          <SubjectTile subject="bio" name={c.biology} progress={0.5} caption={c.chapters20} illustration="subject-biology" offline chip={{ label: c.needsInternet, icon: "CloudSlash", tone: "sunken" }} />
        </div>
      </Stack>
    ),
  },
  {
    id: "questions",
    title: "Option card, Confidence row, Rating buttons",
    render: (c) => (
      <Stack>
        <OptionsDemo c={c} />
        <OptionCard keyLabel="A" label={c.option("A")} state="correct" />
        <OptionCard keyLabel="C" label={c.option("C")} state="wrong" />
        <OptionCard kind="choice" label={c.choiceTitle} description={c.choiceDesc} state="selected" illustration="level-notebook" />
        <OptionCard kind="choice" label={c.choiceTitle} description={c.choiceDesc} illustration="level-pencil" />
        <RatingButtons intervals={{ again: "10 min", hard: "1 d", good: "3 d", easy: "8 d" }} onRate={() => undefined} />
      </Stack>
    ),
  },
  {
    id: "progress",
    title: "Progress",
    render: (c) => (
      <Stack>
        <ProgressBar value={0.62} label={c.goalLabel} subject="chemistry" />
        <ProgressBar value={0.4} label={c.goalLabel} tone="primary" />
        <SegmentedProgress total={8} done={4} current={4} label={c.goalLabel} />
        <Row>
          <ProgressRing value={0.62} label={c.goalLabel} centerText="62%" />
          <ProgressRing value={0.3} size={72} stroke={12} tone="primary" label={c.goalLabel} centerText="3/10" />
          <ScoreRing score={168} max={300} size="md" />
          <ScoreRing score={-12} max={300} size="md" />
        </Row>
      </Stack>
    ),
  },
  {
    id: "chips",
    title: "Chip, Choice chips, Pro, Citation, Save-state",
    render: (c) => (
      <Stack>
        <Row>
          <Chip kind="filter" label={c.filterAll} selected onPress={() => undefined} />
          <Chip kind="filter" label={c.filterUnanswered} onPress={() => undefined} />
          <Chip label={c.freeToday} tone="neutral" icon="Gift" />
          <Chip label={c.needsInternet} icon="CloudSlash" />
          <Chip label={c.physics} tone="subject" subject="physics" />
          <Chip label={c.streakChip} tone="streak" icon="Plant" />
        </Row>
        <ChoiceDemo c={c} />
        <Row>
          <ProChip onPress={() => undefined} />
          <ProChip askGrownUp onPress={() => undefined} />
          <CitationChip examShort="JEE Main" year={2025} sessionLabel="Jan S1" onPress={() => undefined} />
          <CitationChip examShort="NEET" year={2024} sessionLabel="Main" keyStatus="dropped" onPress={() => undefined} />
        </Row>
        <Stack gap={2}>
          <SaveStateChip state="guest" onPress={() => undefined} />
          <SaveStateChip state="saving" />
          <SaveStateChip state="saved" email="aarav.sharma.studies@gmail.com" onPress={() => undefined} />
          <SaveStateChip state="saved_offline" />
          <SaveStateChip state="saved" layout="row" email="a.s@example.com" />
        </Stack>
      </Stack>
    ),
  },
  {
    id: "status",
    title: "Stat tile, Meter, DayDots, Banner, Toast, Empty state",
    render: (c) => (
      <Stack>
        <div className="grid grid-cols-3 gap-2">
          <StatTile value="12" label={c.streakDays} icon="Plant" />
          <StatTile value="48" label={c.lessons} tint subject="chemistry" />
          <StatTile value="71%" label={c.accuracy} tint subject="maths" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Meter kind="mood" label={c.mood} stateWord={c.happy} value={82} />
          <Meter kind="energy" label={c.energy} stateWord={c.good} value={64} />
        </div>
        <DayDots
          label={c.week}
          days={c.days.map((d, i) => ({ label: d, state: i < 2 ? "done" : i === 2 ? "today" : "todo" }))}
        />
        <Banner tone="info" text={c.bannerInfo} onClose={() => undefined} />
        <Banner tone="warning" icon="CreditCard" text={c.bannerWarn} action={{ label: c.update, onPress: () => undefined }} />
        <Banner tone="offline" text={c.bannerOffline} />
        <OverlayDemo c={c} />
        <EmptyState illustration="ui-all-caught-up" text={c.empty} action={{ label: c.emptyAction, onPress: () => undefined }} />
      </Stack>
    ),
  },
  {
    id: "forms",
    title: "Picker, Settings row, Switch",
    render: (c) => <FormDemo c={c} />,
  },
  {
    id: "pro",
    title: "Price block and Trial timeline",
    render: (c) => (
      <Stack gap={4}>
        <PriceBlock price={c.price} thenLine={c.thenLine} finePrint={c.finePrint} />
        <TrialTimeline eligible todayLabel={c.trialToday} reminderDate={c.reminderDate} renewDate={c.renewDate} trialPrice="₹1" renewPrice={c.renewPrice} />
        <TrialTimeline eligible={false} reminderDate={c.reminderDate} renewDate={c.renewDate} trialPrice="₹1" renewPrice="₹99" />
      </Stack>
    ),
  },
  {
    id: "formula",
    title: "Formula box (KaTeX)",
    render: (c) => (
      <FormulaBox
        latex={"\\frac{a}{b} + \\sqrt{x^{2} + y^{2}}"}
        subject="maths"
        label={c.formulaLabel}
        symbols={[
          { id: "a", label: c.symbolA },
          { id: "x", label: c.symbolX },
        ]}
        onSymbolPress={() => undefined}
        onAddToVault={() => undefined}
      />
    ),
  },
  {
    id: "mock",
    title: "Mock runner: palette, Timer, Section tabs, Keypad, OMR",
    render: (c) => (
      <div data-theme="light" className="flex flex-col gap-3 rounded-card bg-surface p-3 text-ink">
        <Row>
          <Timer mode="countdown" startedAt={T0} endsAt={T0 + 3 * 3600_000} now={() => T0 + 6440_000} warnAtMs={600_000} finalAtMs={120_000} />
          <Timer mode="countdown" startedAt={T0} endsAt={T0 + 3600_000} now={() => T0 + 3100_000} warnAtMs={600_000} finalAtMs={120_000} size="compact" />
          <Timer mode="countdown" startedAt={T0} endsAt={T0 + 3600_000} now={() => T0 + 3540_000} warnAtMs={600_000} finalAtMs={120_000} size="compact" />
          <Timer mode="countup" startedAt={T0} now={() => T0 + 708_000} size="compact" paused pausedMs={708_000} />
        </Row>
        <TabsDemo c={c} />
        <div className="grid grid-cols-6 justify-items-center gap-1">
          {(["answered", "answered", "notAnswered", "answered", "marked", "answered", "answeredMarked", "answered", "notAnswered", "notVisited", "notVisited", "notVisited"] as const).map((s, i) => (
            <MockPaletteCell key={i} number={i + 1} state={s} current={i === 8} onPress={() => undefined} />
          ))}
        </div>
        <KeypadDemo />
        <OmrDemo />
      </div>
    ),
  },
  {
    id: "analytics",
    title: "Score ring, Heat map, Time strip, Leaderboard, Limit meter",
    render: (c) => (
      <Stack>
        <Row>
          <ScoreRing score={168} max={300} />
          <ScoreRing score={0} max={300} loading size="md" />
        </Row>
        <div className="flex flex-wrap gap-1.5">
          {[12, 34, 51, 68, 92, null, 77, 45].map((v, i) => (
            <HeatMapCell key={i} value={v} count={i === 6 ? 2 : 12} minCount={5} label={c.heatLabel(i + 1)} selected={i === 3} onPress={() => undefined} />
          ))}
        </div>
        <TimeStripDemo c={c} />
        <div className="overflow-hidden rounded-card shadow-card">
          {c.leaderboard.map((r, i) => (
            <LeaderboardRow key={r.name} rank={i + 1} avatar={{ kind: "pet", species: i % 2 ? "dog" : "cat" }} name={r.name} score={r.score} />
          ))}
          <LeaderboardRow rank={null} rankPending avatar={{ kind: "initials", initials: "AS" }} name="Aarav S." score="—" />
          <LeaderboardRow rank={14} avatar={{ kind: "pet", species: "cat" }} name="" isSelf score={c.youScore} />
        </div>
        <LimitMeter label={c.limitLabel} used={12} limit={30} onProPress={() => undefined} />
        <LimitMeter label={c.limitLabel} used={27} limit={30} proAction="ask_grown_up" onProPress={() => undefined} />
        <LimitMeter label={c.limitLabel} used={30} limit={30} onProPress={() => undefined} />
        <LimitMeter label={c.mockLimitLabel} used={1} limit={2} lastFewAt={1} period="week" onProPress={() => undefined} />
        <LimitMeter label={c.mockLimitLabel} used={2} limit={2} period="week" onProPress={() => undefined} />
      </Stack>
    ),
  },
  {
    id: "nav",
    title: "Top bar, Tab bar, Sidebar",
    render: (c) => <NavDemo c={c} />,
  },
  {
    id: "chat",
    title: "Chat bubble, Chat input",
    render: (c) => <ChatDemo c={c} />,
  },
  {
    id: "social",
    title: "Friend row, League tier, Duel score, Squad card, Cheer",
    render: (c) => <SocialDemo c={c} />,
  },
  {
    id: "palace",
    title: "Memory palace card",
    render: (c) => (
      <Stack>
        <RoomCard name={c.palaceName} image="scene-memory-palace" imageAlt={c.palaceAlt} meta={c.palaceMeta} due onPress={() => undefined} onWalk={() => undefined} onQuiz={() => undefined} />
        <RoomCard name={c.palaceSystem} image="scene-pet-room" meta={c.palaceMeta} onWalk={() => undefined} />
      </Stack>
    ),
  },
];

type PaneKey = "light-en" | "dark-en" | "light-hi" | "dark-hi";
const paneDefs: Record<PaneKey, { mode: Mode; locale: Locale; title: (c: GalleryCopy) => string }> = {
  "light-en": { mode: "light", locale: "en", title: (c) => c.paneLight },
  "dark-en": { mode: "dark", locale: "en", title: (c) => c.paneDark },
  "light-hi": { mode: "light", locale: "hi", title: (c) => c.paneHindi },
  "dark-hi": { mode: "dark", locale: "hi", title: (c) => c.paneDarkHindi },
};

function useAltText() {
  const [alts, setAlts] = useState<Record<string, { en: string; hi: string }>>({});
  useEffect(() => {
    fetch("/assets/manifest.json")
      .then((r) => (r.ok ? r.json() : { images: [] }))
      .then((m: { images: { file: string; alt?: { en: string; hi: string } }[] }) => {
        const out: Record<string, { en: string; hi: string }> = {};
        for (const i of m.images) if (i.alt) out[i.file.replace(/\.webp$/, "")] = i.alt;
        setAlts(out);
      })
      .catch(() => undefined);
  }, []);
  return useMemo(() => (name: string, locale: Locale) => alts[name]?.[locale], [alts]);
}

export function Gallery() {
  const params = new URLSearchParams(window.location.search);
  const only = params.get("pane") as PaneKey | null;
  const sectionFilter = params.get("section");
  const panes: PaneKey[] = only && only in paneDefs ? [only] : ["light-en", "dark-en", "light-hi"];
  const altText = useAltText();
  const shown = sections.filter((s) => !sectionFilter || sectionFilter.split(",").includes(s.id));
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-surface-sunken font-sans text-ink">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
          <strong className="text-heading">Smriti components</strong>
          <nav className="flex flex-wrap gap-2 text-caption">
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="text-primary-text">
                {s.title}
              </a>
            ))}
          </nav>
        </header>
        <main className="flex flex-col gap-6 p-4">
          {shown.map((s) => (
            <section key={s.id} id={s.id} className="flex flex-col gap-2">
              <h2 className="m-0 text-heading">{s.title}</h2>
              <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 340px), 1fr))` }}>
                {panes.map((p) => {
                  const d = paneDefs[p];
                  const c = galleryCopy[d.locale];
                  return (
                    <UIProvider key={p} locale={d.locale} altText={altText}>
                      <ThemeScope mode={d.mode} locale={d.locale} className="overflow-hidden rounded-card-large p-4 ring-1 ring-line">
                        <div className="mb-3 text-caption text-ink-muted">{d.title(c)}</div>
                        {s.render(c, { mode: d.mode, locale: d.locale })}
                      </ThemeScope>
                    </UIProvider>
                  );
                })}
              </div>
            </section>
          ))}
        </main>
      </div>
    </TooltipProvider>
  );
}

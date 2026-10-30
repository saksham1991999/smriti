// Component gallery screen for the mobile app's dev menu: every DESIGN.md §5 component in light, Night
// Colour and Hindi, with the same sample copy as the web gallery. Mount it on a dev-only route:
//   import { Gallery } from "@smriti/ui-native/gallery";
// It needs <SafeAreaProvider> and a <UIProvider assetBaseUrl> above it (the CDN base, or resolveAsset for bundled images).
import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import type { Mode } from "@smriti/tokens";
import type { Confidence, Locale, NavItem } from "@smriti/tokens/ui";
import { ThemeScope, useTheme } from "./theme";
import { AppleButton, GoogleButton, TrustLine } from "./components/SignInButtons";
import { Button, IconButton } from "./components/Button";
import { ChatBubble, ChatInput } from "./components/Chat";
import { Card, ContinueCard, EmptyState, OptionCard, StatTile, StreakCard, SubjectTile } from "./components/Cards";
import { Chip, ChoiceChips, CitationChip, ProChip, SaveStateChip, StreakPill } from "./components/Chips";
import { Banner, DayDots, Meter, PetLine, Toast } from "./components/Feedback";
import { FormulaBox } from "./components/FormulaBox";
import { Icon } from "./components/Icon";
import { Illustration, PetAvatar, PetView, PlantView } from "./components/Illustration";
import { ConfidenceRow, Picker, RatingButtons, Switch } from "./components/Inputs";
import { SidebarNav, TabBar, TopBar } from "./components/Navigation";
import { Dialog, Sheet, Tooltip } from "./components/Overlays";
import { HeatMapCell, LeaderboardRow, LimitMeter, MockPaletteCell, NumericKeypad, OmrBubbleRow, ScoreRing, SectionTabs, Timer, TimeStrip } from "./components/Practice";
import { ProgressBar, ProgressRing, SegmentedProgress } from "./components/Progress";
import { RoomCard } from "./components/Palace";
import { CheerButton, DuelScoreBar, FriendRow, LeagueTierBadge, SquadCard } from "./components/Social";
import { PriceBlock, SettingsGroup, SettingsRow, TrialTimeline } from "./components/Settings";
import { Text } from "./components/Text";
import { galleryCopy, type GalleryCopy } from "./gallery/copy";

const navIcons = ["House", "Flask", "Exam", "UsersThree", "UserCircle"] as const;
const navItems = (c: GalleryCopy, n: 3 | 4 | 5): NavItem[] => {
  const all = c.tabs.map((label, i) => ({ key: String(i), label, icon: navIcons[i] ?? "House" }));
  if (n === 5) return all;
  if (n === 4) return all.filter((_, i) => i !== 3);
  return all.filter((_, i) => i === 0 || i === 1 || i === 4);
};

function Stack({ children, gap = 12 }: { children: ReactNode; gap?: number }) {
  return <View style={{ gap }}>{children}</View>;
}
function Row({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: wrap ? "wrap" : "nowrap" }}>{children}</View>;
}
function Grid({ children, cols }: { children: ReactNode[]; cols: number }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {children.map((ch, i) => (
        <View key={i} style={{ flexBasis: `${100 / cols - 4}%`, flexGrow: 1 }}>
          {ch}
        </View>
      ))}
    </View>
  );
}
function Label({ children }: { children: ReactNode }) {
  return (
    <Text variant="caption" tone="muted">
      {children}
    </Text>
  );
}

function OptionsDemo({ c }: { c: GalleryCopy }) {
  const [sel, setSel] = useState<string | null>("B");
  const [conf, setConf] = useState<Confidence | null>("half");
  return (
    <Stack>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {["A", "B", "C", "D"].map((k) => (
          <OptionCard key={k} keyLabel={k} label={c.option(k)} state={sel === k ? "selected" : "idle"} onPress={() => setSel(k)} />
        ))}
      </View>
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
  const [year, setYear] = useState<string | null>("2012");
  const [month, setMonth] = useState<string | null>("2");
  const [sound, setSound] = useState(true);
  return (
    <Stack>
      <Grid cols={2}>
        <Picker label={c.monthLabel} value={month} onChange={setMonth} options={c.months.map((m, i) => ({ value: String(i + 1), label: m }))} />
        <Picker label={c.yearLabel} value={year} onChange={setYear} options={["2010", "2011", "2012", "2013", "2014"].map((y) => ({ value: y, label: y }))} />
      </Grid>
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
  return <NumericKeypad value={v} onChange={setV} />;
}

function OmrDemo() {
  const [a, setA] = useState<number | null>(1);
  const [b, setB] = useState<number | null>(null);
  return (
    <Stack gap={8}>
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
  return (
    <Stack>
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
      <Dialog open={dialog} onOpenChange={setDialog} title={c.dialogTitle} description={c.dialogBody} confirm={{ label: c.signOut, onPress: () => setDialog(false) }} cancel={{ label: c.cancel, onPress: () => setDialog(false) }} />
    </Stack>
  );
}

function NavDemo({ c }: { c: GalleryCopy }) {
  const theme = useTheme();
  const [tab, setTab] = useState("0");
  const frame = { overflow: "hidden" as const, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.bg };
  return (
    <Stack>
      <View style={frame}>
        <TopBar title={c.screenTitle} onBack={() => undefined} actions={[{ icon: "MagnifyingGlass", label: c.search, onPress: () => undefined }]} />
        <TabBar items={navItems(c, 5)} activeKey={tab} onSelect={setTab} />
      </View>
      <Label>Phase 1 (4 tabs) · little learners (3 tabs)</Label>
      <View style={frame}>
        <TabBar items={navItems(c, 4)} activeKey={tab} onSelect={setTab} />
      </View>
      <View style={frame}>
        <TabBar items={navItems(c, 3)} activeKey={tab === "3" || tab === "2" ? "0" : tab} onSelect={setTab} />
      </View>
      <View style={[frame, { height: 288 }]}>
        <SidebarNav
          items={navItems(c, 4)}
          activeKey={tab}
          onSelect={setTab}
          style={{ height: "100%" }}
          header={
            <View style={{ marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: theme.radius.md, backgroundColor: theme.colors.streakTint, padding: 8 }}>
              <PlantView stage="sapling" size={40} decorative />
              <StreakPill days={12} />
            </View>
          }
        />
      </View>
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

const T0 = Date.UTC(2026, 9, 29, 10, 0, 0);
type Render = (c: GalleryCopy) => ReactNode;

export const gallerySections: { id: string; title: string; render: Render }[] = [
  {
    id: "type",
    title: "Type and colour",
    render: (c) => <TypeDemo c={c} />,
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
    render: () => <SignInDemo />,
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
        <Row>
          {(["seed", "sprout", "sapling", "flowering", "tree"] as const).map((s) => (
            <PlantView key={s} stage={s} size={56} />
          ))}
        </Row>
        <Row>
          {(["droopy", "dry", "wilted", "dormant"] as const).map((h) => (
            <PlantView key={h} stage="sapling" health={h} size={56} />
          ))}
          <Illustration name="subject-chemistry" width={56} height={56} />
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
        <View style={{ paddingTop: 12 }}>
          <Grid cols={2}>
            <SubjectTile subject="phy" name={c.physics} next={c.nextTopic} progress={0.34} caption={c.chapters21} illustration="subject-physics" onPress={() => undefined} />
            <SubjectTile subject="chem" name={c.chemistry} next={c.nextTopic} progress={0.18} caption={c.chapters20} illustration="subject-chemistry" chip={{ label: c.freeToday, icon: "Gift" }} onPress={() => undefined} />
            <SubjectTile subject="math" name={c.maths} progress={0.09} caption={c.chapters25} illustration="subject-maths" onPress={() => undefined} />
            <SubjectTile subject="bio" name={c.biology} progress={0.5} caption={c.chapters20} illustration="subject-biology" offline chip={{ label: c.needsInternet, icon: "CloudSlash", tone: "sunken" }} />
          </Grid>
        </View>
        <Card>
          <Text variant="body">{c.sheetBody}</Text>
        </Card>
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
        <Stack gap={8}>
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
        <Grid cols={3}>
          <StatTile value="12" label={c.streakDays} icon="Plant" />
          <StatTile value="48" label={c.lessons} tint subject="chemistry" />
          <StatTile value="71%" label={c.accuracy} tint subject="maths" />
        </Grid>
        <Grid cols={2}>
          <Meter kind="mood" label={c.mood} stateWord={c.happy} value={82} />
          <Meter kind="energy" label={c.energy} stateWord={c.good} value={64} />
        </Grid>
        <DayDots label={c.week} days={c.days.map((d, i) => ({ label: d, state: i < 2 ? "done" : i === 2 ? "today" : "todo" }))} />
        <Banner tone="info" text={c.bannerInfo} onClose={() => undefined} />
        <Banner tone="warning" icon="CreditCard" text={c.bannerWarn} action={{ label: c.update, onPress: () => undefined }} />
        <Banner tone="offline" text={c.bannerOffline} />
        <OverlayDemo c={c} />
        <EmptyState illustration="ui-all-caught-up" text={c.empty} action={{ label: c.emptyAction, onPress: () => undefined }} />
      </Stack>
    ),
  },
  { id: "forms", title: "Picker, Settings row, Switch", render: (c) => <FormDemo c={c} /> },
  {
    id: "pro",
    title: "Price block and Trial timeline",
    render: (c) => (
      <Stack gap={16}>
        <PriceBlock price={c.price} thenLine={c.thenLine} finePrint={c.finePrint} />
        <TrialTimeline eligible todayLabel={c.trialToday} reminderDate={c.reminderDate} renewDate={c.renewDate} trialPrice="₹1" renewPrice={c.renewPrice} />
        <TrialTimeline eligible={false} reminderDate={c.reminderDate} renewDate={c.renewDate} trialPrice="₹1" renewPrice="₹99" />
      </Stack>
    ),
  },
  {
    id: "formula",
    title: "Formula box",
    render: (c) => (
      <Stack gap={8}>
        <Label>Native draws the content bundle's pre-rendered KaTeX SVG; none is bundled in the gallery, so this shows the loading state.</Label>
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
      </Stack>
    ),
  },
  { id: "mock", title: "Mock runner: palette, Timer, Section tabs, Keypad, OMR", render: (c) => <MockDemo c={c} /> },
  {
    id: "analytics",
    title: "Score ring, Heat map, Time strip, Leaderboard, Limit meter",
    render: (c) => <AnalyticsDemo c={c} />,
  },
  { id: "nav", title: "Top bar, Tab bar, Sidebar", render: (c) => <NavDemo c={c} /> },
  { id: "chat", title: "Chat bubble, Chat input", render: (c) => <ChatDemo c={c} /> },
  { id: "social", title: "Friend row, League tier, Duel score, Squad card, Cheer", render: (c) => <SocialDemo c={c} /> },
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

function ChatDemo({ c }: { c: GalleryCopy }) {
  const theme = useTheme();
  const [value, setValue] = useState(c.chatDraft);
  const [streaming, setStreaming] = useState(false);
  return (
    <Stack>
      <View style={{ gap: 12, borderRadius: theme.radius.card, backgroundColor: theme.colors.bg, padding: 12, borderWidth: 1, borderColor: theme.colors.line }}>
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
      </View>
      <View style={{ overflow: "hidden", borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.line }}>
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
      </View>
      <View style={{ overflow: "hidden", borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.line }}>
        <ChatInput value="" onChange={() => undefined} onSend={() => undefined} label={c.chatLabel} placeholder={c.chatPlaceholder} disabled />
      </View>
    </Stack>
  );
}

function SocialDemo({ c }: { c: GalleryCopy }) {
  const theme = useTheme();
  const [picked, setPicked] = useState(1);
  const [cheered, setCheered] = useState<number[]>([1]);
  const icons = ["HandsClapping", "Star", "Barbell", "Smiley"] as const;
  const msgIcons = ["UsersThree", "Plant", "Sparkle", "Lightning"] as const;
  const listBox = [{ borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, paddingVertical: 4 }, theme.shadow.card];
  return (
    <Stack>
      <View style={listBox}>
        <FriendRow name={c.friends[0] ?? ""} avatar={{ species: "dog" }} studiedToday streakDays={12} />
        <FriendRow name={c.friends[1] ?? ""} avatar={{ species: "cat", mood: "curious" }} studiedToday={false} streakDays={3} />
        <FriendRow name={c.friends[2] ?? ""} avatar={{ species: "dog" }} studyingNow />
      </View>
      <Label>SOC-15 pick a friend</Label>
      <View accessibilityRole="radiogroup" style={listBox}>
        {c.friends.map((f, i) => (
          <FriendRow key={f} name={f} avatar={{ species: i % 2 ? "cat" : "dog" }} selectable selected={picked === i} disabled={i === 2} note={i === 2 ? c.friendNote : undefined} onPress={() => setPicked(i)} />
        ))}
      </View>
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
      <Grid cols={2}>
        {c.cheerMessages.map((m, i) => (
          <CheerButton key={m} kind="message" label={m} icon={msgIcons[i] ?? "Star"} sent={i === 1} disabled={i === 3} onPress={() => undefined} />
        ))}
      </Grid>
    </Stack>
  );
}

function TypeDemo({ c }: { c: GalleryCopy }) {
  const theme = useTheme();
  return (
    <Stack gap={8}>
      <Text variant="display">{c.sheetTitle}</Text>
      <Text variant="title">{c.screenTitle}</Text>
      <Text variant="heading">{c.physics}</Text>
      <Text variant="body">{c.sheetBody}</Text>
      <Text variant="label">{c.studyPrefs}</Text>
      <Text variant="caption" tone="muted">
        {c.chapters21}
      </Text>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
        {(["physics", "chemistry", "biology", "maths", "history", "polity", "language"] as const).map((s) => (
          <View key={s} style={{ flex: 1, gap: 4 }}>
            <View style={{ height: 28, borderRadius: theme.radius.xs, backgroundColor: theme.subjects[s].tint }} />
            <View style={{ height: 28, borderRadius: theme.radius.xs, backgroundColor: theme.subjects[s].strong }} />
          </View>
        ))}
      </View>
      <Row>
        {(["Plant", "Snowflake", "Lightbulb", "Exam", "Flask", "LockSimple", "CloudCheck", "Timer"] as const).map((n) => (
          <Icon key={n} name={n} weight={n === "Plant" ? "fill" : "bold"} color={n === "Plant" ? "streak" : "ink"} label={n} />
        ))}
      </Row>
    </Stack>
  );
}

function SignInDemo() {
  const theme = useTheme();
  return (
    <Stack>
      <GoogleButton />
      <AppleButton />
      <TrustLine />
      <Label>Neutral theme on a tinted ground · loading</Label>
      <View style={{ gap: 12, borderRadius: theme.radius.card, backgroundColor: theme.colors.primaryTint, padding: 12 }}>
        <GoogleButton theme="neutral" text="signIn" />
        <GoogleButton loading />
      </View>
    </Stack>
  );
}

/** The exam-standard mock runner stays light in Night Colour, like the web gallery. */
function MockDemo({ c }: { c: GalleryCopy }) {
  return (
    <ThemeScope mode="light">
      <MockInner c={c} />
    </ThemeScope>
  );
}
function MockInner({ c }: { c: GalleryCopy }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 12, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, padding: 12 }}>
      <Row>
        <Timer mode="countdown" startedAt={T0} endsAt={T0 + 3 * 3600_000} now={() => T0 + 6440_000} warnAtMs={600_000} finalAtMs={120_000} />
        <Timer mode="countdown" startedAt={T0} endsAt={T0 + 3600_000} now={() => T0 + 3100_000} warnAtMs={600_000} finalAtMs={120_000} size="compact" />
        <Timer mode="countdown" startedAt={T0} endsAt={T0 + 3600_000} now={() => T0 + 3540_000} warnAtMs={600_000} finalAtMs={120_000} size="compact" />
        <Timer mode="countup" startedAt={T0} now={() => T0 + 708_000} size="compact" paused pausedMs={708_000} />
      </Row>
      <TabsDemo c={c} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 4 }}>
        {(["answered", "answered", "notAnswered", "answered", "marked", "answered", "answeredMarked", "answered", "notAnswered", "notVisited", "notVisited", "notVisited"] as const).map((s, i) => (
          <MockPaletteCell key={i} number={i + 1} state={s} current={i === 8} onPress={() => undefined} />
        ))}
      </View>
      <KeypadDemo />
      <OmrDemo />
    </View>
  );
}

function AnalyticsDemo({ c }: { c: GalleryCopy }) {
  const theme = useTheme();
  return (
    <Stack>
      <Row>
        <ScoreRing score={168} max={300} />
        <ScoreRing score={0} max={300} loading size="md" />
      </Row>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {[12, 34, 51, 68, 92, null, 77, 45].map((v, i) => (
          <HeatMapCell key={i} value={v} count={i === 6 ? 2 : 12} minCount={5} label={c.heatLabel(i + 1)} selected={i === 3} onPress={() => undefined} />
        ))}
      </View>
      <TimeStripDemo c={c} />
      <View style={[{ overflow: "hidden", borderRadius: theme.radius.card }, theme.shadow.card]}>
        {c.leaderboard.map((r, i) => (
          <LeaderboardRow key={r.name} rank={i + 1} avatar={{ kind: "pet", species: i % 2 ? "dog" : "cat" }} name={r.name} score={r.score} />
        ))}
        <LeaderboardRow rank={null} rankPending avatar={{ kind: "initials", initials: "AS" }} name="Aarav S." score="—" />
        <LeaderboardRow rank={14} avatar={{ kind: "pet", species: "cat" }} name="" isSelf score={c.youScore} />
      </View>
      <LimitMeter label={c.limitLabel} used={12} limit={30} onProPress={() => undefined} />
      <LimitMeter label={c.limitLabel} used={27} limit={30} proAction="ask_grown_up" onProPress={() => undefined} />
      <LimitMeter label={c.limitLabel} used={30} limit={30} onProPress={() => undefined} />
      <LimitMeter label={c.mockLimitLabel} used={1} limit={2} lastFewAt={1} period="week" onProPress={() => undefined} />
      <LimitMeter label={c.mockLimitLabel} used={2} limit={2} period="week" onProPress={() => undefined} />
    </Stack>
  );
}

type PaneKey = "light-en" | "dark-en" | "light-hi" | "dark-hi";
const panes: Record<PaneKey, { mode: Mode; locale: Locale; title: (c: GalleryCopy) => string }> = {
  "light-en": { mode: "light", locale: "en", title: (c) => c.paneLight },
  "dark-en": { mode: "dark", locale: "en", title: (c) => c.paneDark },
  "light-hi": { mode: "light", locale: "hi", title: (c) => c.paneHindi },
  "dark-hi": { mode: "dark", locale: "hi", title: (c) => c.paneDarkHindi },
};

export interface GalleryProps {
  initialPane?: PaneKey;
  /** Only these section ids (default all). */
  sections?: string[];
}

/** Dev-menu screen: pick a pane (light, Night Colour, Hindi) and scroll every component. */
export function Gallery({ initialPane = "light-en", sections }: GalleryProps) {
  const [pane, setPane] = useState<PaneKey>(initialPane);
  const d = panes[pane];
  const c = galleryCopy[d.locale];
  const shown = gallerySections.filter((s) => !sections || sections.includes(s.id));
  return (
    <ThemeScope mode={d.mode} locale={d.locale}>
      <GalleryBody pane={pane} setPane={setPane} c={c} shown={shown} />
    </ThemeScope>
  );
}

function GalleryBody({ pane, setPane, c, shown }: { pane: PaneKey; setPane: (p: PaneKey) => void; c: GalleryCopy; shown: typeof gallerySections }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.line, backgroundColor: theme.colors.surface, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text variant="heading" heading>
          Smriti components
        </Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(Object.keys(panes) as PaneKey[]).map((k) => (
            <Chip key={k} kind="filter" role="radio" label={panes[k].title(galleryCopy[panes[k].locale])} selected={k === pane} onPress={() => setPane(k)} />
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ gap: 24, padding: 16, paddingBottom: 48 }}>
        {shown.map((s) => (
          <View key={s.id} testID={`gallery-${s.id}`} style={{ gap: 12 }}>
            <Text variant="heading" heading>
              {s.title}
            </Text>
            {s.render(c)}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

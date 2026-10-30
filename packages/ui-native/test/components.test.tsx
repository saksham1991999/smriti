import { fireEvent, screen } from "@testing-library/react-native";
import { iconNames } from "@smriti/tokens/ui";
import { nativeThemes } from "@smriti/tokens/native";
import { smritiFonts } from "../src/fonts";
import {
  AppleButton,
  Banner,
  Button,
  CitationChip,
  ChoiceChips,
  ConfidenceRow,
  ContinueCard,
  DayDots,
  Dialog,
  EmptyState,
  FormulaBox,
  GoogleButton,
  HeatMapCell,
  Icon,
  iconMap,
  IconButton,
  Illustration,
  LeaderboardRow,
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
  SaveStateChip,
  ScoreRing,
  SectionTabs,
  SegmentedProgress,
  SettingsGroup,
  SettingsRow,
  Sheet,
  SidebarNav,
  StatTile,
  StreakCard,
  StreakPill,
  SubjectTile,
  Switch,
  TabBar,
  Text,
  ThemeScope,
  Timer,
  TimeStrip,
  Toast,
  Tooltip,
  TopBar,
  TrialTimeline,
  TrustLine,
  useTheme,
} from "../src";
import { Gallery } from "../src/Gallery";
import { renderUI } from "./render";

const flat = (style: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (Array.isArray(s)) s.forEach(walk);
    else if (s && typeof s === "object") Object.assign(out, s);
  };
  walk(style);
  return out;
};

describe("foundations", () => {
  it("maps every shared icon name to a Phosphor component (parity with ui-web)", () => {
    expect(Object.keys(iconMap).sort()).toEqual([...iconNames].sort());
  });

  it("names a font file for every family the theme uses", () => {
    const families = [...Object.values(nativeThemes.light.fonts.latin), ...Object.values(nativeThemes.light.fonts.devanagari)];
    for (const f of families) expect(smritiFonts[f]).toBeDefined();
  });

  it("Text uses Plus Jakarta Sans for English and Noto Sans Devanagari at 1.15x for Hindi", async () => {
    await renderUI(
      <>
        <Text testID="en">Physics</Text>
        <Text testID="hi">भौतिकी</Text>
      </>,
    );
    const en = flat(screen.getByTestId("en").props.style);
    const hi = flat(screen.getByTestId("hi").props.style);
    expect(en.fontFamily).toMatch(/^PlusJakartaSans_/);
    expect(hi.fontFamily).toMatch(/^NotoSansDevanagari_/);
    expect(Number(hi.lineHeight)).toBeGreaterThan(Number(en.lineHeight));
  });

  it("titles are spoken as headers and icons with a label are images", async () => {
    await renderUI(
      <>
        <Text variant="title">Settings</Text>
        <Icon name="Plant" label="Streak" />
      </>,
    );
    expect(screen.getByRole("header", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("image", { name: "Streak" })).toBeTruthy();
  });

  it("ThemeScope switches to Night Colour", async () => {
    let bg = "";
    function Probe() {
      bg = useTheme().colors.bg;
      return null;
    }
    await renderUI(
      <ThemeScope mode="dark">
        <Probe />
      </ThemeScope>,
    );
    expect(bg).toBe(nativeThemes.dark.colors.bg);
  });
});

describe("actions", () => {
  it("Button presses, and does not press when disabled or loading", async () => {
    const onPress = jest.fn();
    await renderUI(
      <>
        <Button label="Start lesson" onPress={onPress} />
        <Button label="Check" disabled onPress={onPress} />
        <Button label="Saving" loading onPress={onPress} />
      </>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Start lesson" }));
    await fireEvent.press(screen.getByRole("button", { name: "Check" }));
    await fireEvent.press(screen.getByRole("button", { name: "Saving" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Check" }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("IconButton has a label and a 48 px hit area", async () => {
    await renderUI(<IconButton icon="MagnifyingGlass" label="Search" size={40} />);
    const b = screen.getByRole("button", { name: "Search" });
    expect(b.props.hitSlop).toMatchObject({ left: 4, right: 4, top: 4, bottom: 4 });
  });

  it("Google, Apple and the trust line render their fixed strings in Hindi", async () => {
    await renderUI(
      <>
        <GoogleButton />
        <AppleButton />
        <TrustLine />
      </>,
      { locale: "hi" },
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByLabelText(/Google/)).toBeTruthy();
  });
});

describe("learning cards", () => {
  it("SubjectTile and ContinueCard", async () => {
    const onPress = jest.fn();
    await renderUI(
      <>
        <SubjectTile subject="phy" name="Physics" progress={0.34} caption="21 chapters" illustration="subject-physics" onPress={onPress} />
        <ContinueCard subject="phy" eyebrow="Continue" title="Topic title" progress={0.62} onPress={onPress} />
      </>,
    );
    await fireEvent.press(screen.getByRole("button", { name: /Physics/ }));
    await fireEvent.press(screen.getByRole("button", { name: /Resume/ }));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it("StreakCard reads the freeze count and the at-risk state", async () => {
    await renderUI(<StreakCard message="One lesson waters it" atRisk freezes={{ ready: 1, slots: 2 }} goal={{ done: 4, target: 10 }} plant={{ stage: "sapling", health: "droopy" }} />);
    expect(screen.getByLabelText("1 freeze ready")).toBeTruthy();
    expect(screen.getByLabelText("Streak at risk")).toBeTruthy();
  });

  it("StreakPill uses Plant and says the days", async () => {
    await renderUI(<StreakPill days={12} />);
    expect(screen.getByRole("image", { name: "12-day streak" })).toBeTruthy();
  });

  it("OptionCard is a radio that says correct and wrong, not only colour", async () => {
    const onPress = jest.fn();
    await renderUI(
      <>
        <OptionCard keyLabel="A" label="Option A" onPress={onPress} />
        <OptionCard keyLabel="B" label="Option B" state="correct" />
        <OptionCard keyLabel="C" label="Option C" state="wrong" />
      </>,
    );
    await fireEvent.press(screen.getByRole("radio", { name: /Option A/ }));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Option B, Correct/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Option C, Wrong/ })).toBeTruthy();
  });

  it("StatTile, EmptyState, PriceBlock", async () => {
    const onPress = jest.fn();
    await renderUI(
      <>
        <StatTile value="12" label="Day streak" />
        <EmptyState illustration="ui-all-caught-up" text="Nothing yet" action={{ label: "Find a lesson", onPress }} />
        <PriceBlock price="₹1" thenLine="then ₹99/month" />
      </>,
    );
    expect(screen.getByLabelText("12 Day streak")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Find a lesson" }));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByText("₹1")).toBeTruthy();
  });
});

describe("illustrations", () => {
  it("loads {base}{name}.webp and falls back down the chain on error", async () => {
    await renderUI(<Illustration testID="art" name="cat-sadButHopeful" fallback={["cat-worried", "cat-base"]} alt="Cat" />);
    const img = () => screen.getByTestId("art-image");
    expect(img().props.source).toEqual({ uri: "https://cdn.example.test/assets/cat-sadButHopeful.webp" });
    await fireEvent(img(), "error");
    expect(img().props.source).toEqual({ uri: "https://cdn.example.test/assets/cat-worried.webp" });
  });

  it("PetView and PlantView use the Rive seam when the app provides one", async () => {
    const { UIProvider } = require("../src/theme");
    const { Text: RNText } = require("react-native");
    const { render } = require("@testing-library/react-native");
    await render(
      <UIProvider mode="light" renderPet={({ mood }: { mood: string }) => <RNText>rive pet {mood}</RNText>} renderPlant={({ stage }: { stage: string }) => <RNText>rive plant {stage}</RNText>}>
        <PetView species="cat" mood="proud" />
        <PlantView stage="tree" />
        <PetAvatar species="dog" />
      </UIProvider>,
    );
    expect(screen.getByText("rive pet proud")).toBeTruthy();
    expect(screen.getByText("rive plant tree")).toBeTruthy();
  });
});

describe("progress and chips", () => {
  it("progress parts expose progressbar values", async () => {
    await renderUI(
      <>
        <ProgressBar value={0.62} label="Daily goal" />
        <ProgressRing value={0.3} label="Ring" centerText="30%" />
        <SegmentedProgress total={8} done={4} label="Lesson" />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Daily goal" }).props.accessibilityValue).toMatchObject({ now: 62, text: "62% done" });
    expect(screen.getByText("30%")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Lesson" }).props.accessibilityValue).toMatchObject({ text: "4 of 8" });
  });

  it("ChoiceChips single and multiple select", async () => {
    const onChange = jest.fn();
    await renderUI(<ChoiceChips label="Daily goal" options={[{ value: "5", label: "5 min" }, { value: "10", label: "10 min" }]} value={["5"]} multiple onChange={onChange} />);
    await fireEvent.press(screen.getByRole("checkbox", { name: "10 min" }));
    expect(onChange).toHaveBeenCalledWith(["5", "10"]);
  });

  it("ProChip says Ask a grown-up for under-13s and CitationChip flags dropped keys", async () => {
    await renderUI(
      <>
        <ProChip askGrownUp />
        <CitationChip examShort="NEET" year={2024} sessionLabel="Main" keyStatus="dropped" />
      </>,
    );
    expect(screen.getByText("Ask a grown-up")).toBeTruthy();
    expect(screen.getByText("NEET 2024 · Main · Dropped")).toBeTruthy();
  });

  it("SaveStateChip shortens long emails and never shows an Apple email", async () => {
    await renderUI(
      <>
        <SaveStateChip state="saved" email="aarav.sharma.studies@gmail.com" maxChars={20} />
        <SaveStateChip state="saved" provider="apple" email="x@privaterelay.appleid.com" />
      </>,
    );
    expect(screen.getByText("Saved to aarav.sha…@gmail.com")).toBeTruthy();
    expect(screen.getByText("Saved to your Apple account")).toBeTruthy();
  });
});

describe("inputs", () => {
  it("ConfidenceRow selects and clears", async () => {
    const onChange = jest.fn();
    await renderUI(<ConfidenceRow value="sure" onChange={onChange} />);
    await fireEvent.press(screen.getByRole("radio", { name: "Sure" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    await fireEvent.press(screen.getByRole("radio", { name: "Guess" }));
    expect(onChange).toHaveBeenLastCalledWith("guess");
  });

  it("RatingButtons speak the next interval", async () => {
    const onRate = jest.fn();
    await renderUI(<RatingButtons intervals={{ again: "10 min", hard: "1 d", good: "3 d", easy: "8 d" }} onRate={onRate} />);
    await fireEvent.press(screen.getByRole("button", { name: "Good, next review in 3 d" }));
    expect(onRate).toHaveBeenCalledWith("good");
  });

  it("Picker is adjustable for screen readers", async () => {
    const onChange = jest.fn();
    await renderUI(<Picker label="Year" value="2011" onChange={onChange} options={["2010", "2011", "2012"].map((y) => ({ value: y, label: y }))} />);
    const p = screen.getByRole("adjustable", { name: "Year" });
    await fireEvent(p, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
    expect(onChange).toHaveBeenCalledWith("2012");
  });

  it("Switch toggles and SettingsRow carries a value", async () => {
    const onChange = jest.fn();
    const onPress = jest.fn();
    await renderUI(
      <SettingsGroup title="Learning">
        <SettingsRow title="Notifications" value="On" onPress={onPress} />
        <SettingsRow title="Sound" trailing="switch" checked={false} onCheckedChange={onChange} />
      </SettingsGroup>,
    );
    await fireEvent.press(screen.getByRole("switch", { name: "Sound" }));
    expect(onChange).toHaveBeenCalledWith(true);
    await fireEvent.press(screen.getByRole("button", { name: "Notifications, On" }));
    expect(onPress).toHaveBeenCalled();
  });
});

describe("feedback and overlays", () => {
  it("Banner, Meter, DayDots, PetLine", async () => {
    const onClose = jest.fn();
    await renderUI(
      <>
        <Banner tone="info" text="New lessons" onClose={onClose} />
        <Meter kind="mood" label="Mood" stateWord="Happy" value={82} />
        <DayDots label="Week" days={[{ label: "Mon", state: "done" }, { label: "Tue", state: "today" }]} />
        <PetLine pet={{ species: "cat" }} petName="Miso" text="Hi!" />
      </>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByRole("progressbar", { name: "Mood" }).props.accessibilityValue.text).toBe("Mood: Happy, about three quarters full");
    expect(screen.getByLabelText("Tue, today")).toBeTruthy();
    expect(screen.getByLabelText("Miso says: Hi!")).toBeTruthy();
  });

  it("Toast dismisses itself after its duration, but errors stay", async () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    const onErr = jest.fn();
    await renderUI(
      <>
        <Toast open message="Saved" onDismiss={onDismiss} durationMs={1000} />
        <Toast open tone="error" message="Failed" onDismiss={onErr} durationMs={1000} />
      </>,
    );
    jest.advanceTimersByTime(1500);
    expect(onDismiss).toHaveBeenCalled();
    expect(onErr).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("Sheet and Dialog show their titles and close", async () => {
    const onOpenChange = jest.fn();
    const onConfirm = jest.fn();
    await renderUI(
      <>
        <Sheet open onOpenChange={onOpenChange} title="Keep your progress" />
        <Dialog open onOpenChange={() => undefined} title="Sign out?" confirm={{ label: "Sign out", onPress: onConfirm }} cancel={{ label: "Cancel", onPress: () => undefined }} />
        <Tooltip label="More options">
          <IconButton icon="DotsThreeVertical" label="More options" />
        </Tooltip>
      </>,
    );
    expect(screen.getByText("Keep your progress")).toBeTruthy();
    await fireEvent.press(screen.getAllByRole("button", { name: "Close" })[0]!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("FormulaBox speaks its label and offers the vault", async () => {
    const onAdd = jest.fn();
    await renderUI(<FormulaBox latex="a" svg={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>'} label="a over b" onAddToVault={onAdd} />);
    expect(screen.getByRole("image", { name: "a over b" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Add to formula vault" }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe("navigation", () => {
  const items = [
    { key: "learn", label: "Learn", icon: "House" as const },
    { key: "me", label: "Me", icon: "UserCircle" as const, badge: "2" },
  ];
  it("TabBar, SidebarNav and TopBar", async () => {
    const onSelect = jest.fn();
    const onBack = jest.fn();
    await renderUI(
      <>
        <TopBar title="Settings" onBack={onBack} />
        <TabBar items={items} activeKey="learn" onSelect={onSelect} />
        <SidebarNav items={items} activeKey="learn" onSelect={onSelect} />
      </>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getAllByRole("tab", { name: "Learn" })[0]!.props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getAllByRole("tab", { name: "Me, 2" })[0]!);
    expect(onSelect).toHaveBeenCalledWith("me");
  });
});

describe("practice and mocks", () => {
  it("MockPaletteCell says number, state and current", async () => {
    await renderUI(<MockPaletteCell number={9} state="notAnswered" current />);
    expect(screen.getByRole("button", { name: "Question 9, Not answered, current question" })).toBeTruthy();
  });

  it("Timer counts down and shows warning phase", async () => {
    const t0 = 1_000_000;
    await renderUI(<Timer mode="countdown" startedAt={t0} endsAt={t0 + 3_600_000} now={() => t0 + 3_100_000} warnAtMs={600_000} />);
    expect(screen.getByRole("timer", { name: "Time left 00:08:20" })).toBeTruthy();
  });

  it("SectionTabs: locked sections are disabled", async () => {
    const onSelect = jest.fn();
    await renderUI(
      <SectionTabs
        label="Sections"
        activeCode="p"
        onSelect={onSelect}
        sections={[
          { code: "p", title: "Physics", answered: 6, total: 25, state: "open" },
          { code: "m", title: "Maths", answered: 0, total: 25, state: "locked" },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Maths, 0 of 25 answered, closed" }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("NumericKeypad builds a number", async () => {
    let value = "";
    const onChange = jest.fn((v: string) => (value = v));
    const view = await renderUI(<NumericKeypad value={value} onChange={onChange} />);
    await fireEvent.press(screen.getByRole("button", { name: "7" }));
    expect(onChange).toHaveBeenLastCalledWith("7");
    await view.rerender(<NumericKeypad value="7" onChange={onChange} />);
    await fireEvent.press(screen.getByRole("button", { name: "decimal point" }));
    expect(onChange).toHaveBeenLastCalledWith("7.");
  });

  it("OmrBubbleRow fills and clears", async () => {
    const onSelect = jest.fn();
    const onClear = jest.fn();
    await renderUI(<OmrBubbleRow questionNo={12} options={["1", "2", "3", "4"]} selected={1} onSelect={onSelect} onClear={onClear} flagged />);
    await fireEvent.press(screen.getByRole("radio", { name: "Question 12, option 3, empty" }));
    expect(onSelect).toHaveBeenCalledWith(2);
    await fireEvent.press(screen.getByText("Clear"));
    expect(onClear).toHaveBeenCalled();
    expect(screen.getByLabelText("Flagged")).toBeTruthy();
  });

  it("ScoreRing prints negative scores with a true minus", async () => {
    await renderUI(<ScoreRing score={-12} max={300} />);
    expect(screen.getByText("−12")).toBeTruthy();
  });

  it("HeatMapCell prints the percent or says not enough data", async () => {
    await renderUI(
      <>
        <HeatMapCell value={68} count={12} minCount={5} label="Chapter 1" />
        <HeatMapCell value={77} count={2} minCount={5} label="Chapter 2" />
      </>,
    );
    expect(screen.getByRole("image", { name: "Chapter 1: 68% right" })).toBeTruthy();
    expect(screen.getByRole("image", { name: "Chapter 2: Not enough data" })).toBeTruthy();
  });

  it("TimeStrip switches to a table", async () => {
    await renderUI(<TimeStrip label="Time" items={[{ questionNo: 1, timeMs: 65_000, targetMs: 90_000, result: "right" }]} />);
    expect(screen.getByRole("button", { name: "Question 1, 1 min 05 s, Right" })).toBeTruthy();
    await fireEvent.press(screen.getByText("Show as table"));
    expect(screen.getByText("Target")).toBeTruthy();
  });

  it("LeaderboardRow shows You for self and Rank soon when pending", async () => {
    await renderUI(
      <>
        <LeaderboardRow rank={14} avatar={{ kind: "pet", species: "cat" }} name="" isSelf score="860" />
        <LeaderboardRow rank={null} rankPending avatar={{ kind: "initials", initials: "AS" }} name="Aarav S." score="—" />
      </>,
    );
    expect(screen.getByLabelText("Rank 14, You, 860")).toBeTruthy();
    expect(screen.getByLabelText("Rank Rank soon, Aarav S., —")).toBeTruthy();
  });

  it("LimitMeter shows used of limit and hides for Pro", async () => {
    await renderUI(
      <>
        <LimitMeter label="Free questions today" used={27} limit={30} onProPress={() => undefined} />
        <LimitMeter testID="hidden" label="x" used={1} limit={30} hidden />
      </>,
    );
    expect(screen.getAllByText("27 of 30").length).toBeGreaterThan(0);
    expect(screen.getByText("3 left today")).toBeTruthy();
    expect(screen.queryByTestId("hidden")).toBeNull();
  });

  it("TrialTimeline shows the real dates", async () => {
    await renderUI(<TrialTimeline eligible reminderDate="26 Nov" renewDate="29 Nov" trialPrice="₹1" renewPrice="₹99/month" />);
    expect(screen.getByText("26 Nov: we remind you by push and email")).toBeTruthy();
  });
});

describe("gallery", () => {
  it("renders every section in each pane", async () => {
    await renderUI(<Gallery />);
    expect(screen.getByTestId("gallery-nav")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Light · हिन्दी" }));
    expect(screen.getByText("स्ट्रीक के लिए 4 और रिव्यू")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Night Colour · English" }));
    expect(screen.getByTestId("gallery-mock")).toBeTruthy();
  });
});

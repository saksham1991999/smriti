import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { iconNames } from "@smriti/tokens/ui";
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
  iconMap,
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
  TextField,
  TabBar,
  Text,
  ThemeScope,
  TimeStrip,
  Timer,
  Toast,
  TopBar,
  TrialTimeline,
  TrustLine,
  UIProvider,
  type Locale,
} from "../src";

const wrap = (ui: ReactElement, locale: Locale = "en") => render(<UIProvider locale={locale} assetBaseUrl="https://cdn.example/img/">{ui}</UIProvider>);

describe("foundations", () => {
  it("maps every shared icon name to a Phosphor component", () => {
    expect(Object.keys(iconMap).sort()).toEqual([...iconNames].sort());
  });

  it("ThemeScope sets data-theme, data-exam and lang", () => {
    const { container } = render(
      <ThemeScope mode="dark" exam="neet" locale="hi">
        x
      </ThemeScope>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.dataset.theme).toBe("dark");
    expect(el.dataset.exam).toBe("neet");
    expect(el.lang).toBe("hi");
  });

  it("Text renders variants with tabular figures on request", () => {
    wrap(
      <Text variant="title" numeric>
        42
      </Text>,
    );
    const h = screen.getByRole("heading", { name: "42" });
    expect(h.className).toContain("text-title");
    expect(h.className).toContain("tabular-nums");
  });
});

describe("Button", () => {
  it("fires onPress and is a 56 tall full-width primary by default", async () => {
    const onPress = vi.fn();
    wrap(<Button label="Start" onPress={onPress} />);
    const b = screen.getByRole("button", { name: "Start" });
    expect(b.className).toContain("h-button-height");
    expect(b.className).toContain("w-full");
    await userEvent.click(b);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("keeps the label for width while loading and ignores presses", async () => {
    const onPress = vi.fn();
    wrap(<Button label="Save" loading onPress={onPress} />);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toHaveAttribute("aria-busy", "true");
    await userEvent.click(b);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("disabled buttons drop the glow", () => {
    wrap(<Button label="Check" disabled />);
    const b = screen.getByRole("button", { name: "Check" });
    expect(b).toBeDisabled();
    expect(b.className).not.toContain("shadow-cta");
  });

  it("IconButton always has a label", () => {
    wrap(<IconButton icon="MagnifyingGlass" label="Search" />);
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });
});

describe("sign-in buttons", () => {
  it("Google uses the approved label in English and Hindi and the official G asset", () => {
    wrap(<GoogleButton />);
    const en = screen.getByRole("button", { name: "Continue with Google" });
    expect(en.querySelector("img")?.getAttribute("src")).toMatch(/google-g/);
    wrap(<GoogleButton text="signIn" />, "hi");
    expect(screen.getByRole("button", { name: "Google से साइन इन करें" })).toBeInTheDocument();
  });

  it("Apple and the trust line", () => {
    wrap(
      <>
        <AppleButton />
        <TrustLine />
      </>,
    );
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeInTheDocument();
    expect(screen.getByText("We never call you or share your email.")).toBeInTheDocument();
  });
});

describe("illustrations", () => {
  it("loads by name from the base URL and falls back on error", () => {
    wrap(<Illustration name="missing-art" fallback={["subject-physics"]} alt="Physics art" width={40} height={40} />);
    const img = screen.getByRole("img", { name: "Physics art" });
    expect(img).toHaveAttribute("src", "https://cdn.example/img/missing-art.webp");
    fireEvent.error(img);
    expect(screen.getByRole("img", { name: "Physics art" })).toHaveAttribute("src", "https://cdn.example/img/subject-physics.webp");
  });

  it("shows an image that loads at once (from the cache) and stays shown", () => {
    const { container } = wrap(<Illustration name="subject-physics" alt="Physics art" />);
    const img = screen.getByRole("img", { name: "Physics art" });
    fireEvent.load(img);
    expect(img).not.toHaveClass("opacity-0");
    expect(container.querySelector("[aria-busy]")).toBeNull();
  });

  it("starts over when the name changes", () => {
    const { rerender } = wrap(<Illustration name="subject-physics" alt="Art" />);
    fireEvent.load(screen.getByRole("img", { name: "Art" }));
    rerender(
      <UIProvider assetBaseUrl="https://cdn.example/img/">
        <Illustration name="subject-chemistry" alt="Art" />
      </UIProvider>,
    );
    const img = screen.getByRole("img", { name: "Art" });
    expect(img).toHaveAttribute("src", "https://cdn.example/img/subject-chemistry.webp");
    expect(img).toHaveClass("opacity-0");
  });

  it("is decorative without alt text", () => {
    const { container } = wrap(<Illustration name="subject-physics" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("PetView and PlantView pick files by mood and by stage and health", () => {
    const { container } = wrap(
      <>
        <PetView species="dog" mood="excited" />
        <PlantView stage="sapling" health="dry" />
      </>,
    );
    const srcs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(["https://cdn.example/img/dog-excited.webp", "https://cdn.example/img/plant-sapling-dry.webp"]);
  });

  it("uses the Rive seam when the app provides a renderer", () => {
    render(
      <UIProvider renderPet={({ species, mood }) => <span>{`rive:${species}:${mood}`}</span>}>
        <PetView species="cat" mood="sleepy" />
      </UIProvider>,
    );
    expect(screen.getByText("rive:cat:sleepy")).toBeInTheDocument();
  });
});

describe("cards", () => {
  it("SubjectTile, ContinueCard, StatTile", async () => {
    const onResume = vi.fn();
    wrap(
      <>
        <SubjectTile subject="economy" name="Economy" progress={0.3} caption="12 chapters" onPress={() => undefined} />
        <ContinueCard subject="phy" title="Topic title" progress={0.62} onPress={onResume} />
        <StatTile value="12" label="Day streak" />
      </>,
    );
    expect(screen.getByRole("button", { name: /Economy/ })).toHaveAttribute("data-subject", "polity");
    await userEvent.click(screen.getByRole("button", { name: /Resume/ }));
    expect(onResume).toHaveBeenCalled();
    expect(screen.getByText("Day streak")).toBeInTheDocument();
  });

  it("StreakCard shows freeze slots with labels and turns warning at risk", () => {
    const { container } = wrap(<StreakCard message="One lesson waters it" atRisk goal={{ done: 4, target: 10 }} freezes={{ ready: 1, slots: 2 }} plant={{ stage: "sprout", health: "droopy" }} />);
    expect(screen.getByRole("list", { name: "1 freeze ready" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Freeze ready" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Empty freeze slot" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Streak at risk" })).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain("bg-warning-tint");
  });

  it("StreakPill uses the plant, never a flame, and says the count", () => {
    wrap(<StreakPill days={12} />, "hi");
    expect(screen.getByRole("img", { name: "12 दिन की स्ट्रीक" })).toBeInTheDocument();
  });

  it("OptionCard carries state as text and icon, not colour alone", () => {
    wrap(
      <>
        <OptionCard keyLabel="A" label="Option A" state="correct" />
        <OptionCard keyLabel="B" label="Option B" state="wrong" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Correct" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Wrong" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Option A/ })).toHaveAttribute("aria-checked", "true");
  });

  it("EmptyState has one action", async () => {
    const onPress = vi.fn();
    wrap(<EmptyState pet={{ species: "cat" }} text="Nothing yet" action={{ label: "Find a lesson", onPress }} />);
    await userEvent.click(screen.getByRole("button", { name: "Find a lesson" }));
    expect(onPress).toHaveBeenCalled();
  });

  it("FormulaBox typesets with KaTeX and offers the vault", async () => {
    const onAdd = vi.fn();
    const { container } = wrap(<FormulaBox latex="\\frac{a}{b}" label="a over b" onAddToVault={onAdd} symbols={[{ id: "a", label: "a" }]} onSymbolPress={() => undefined} />);
    expect(screen.getByRole("img", { name: "a over b" })).toBeInTheDocument();
    expect(container.querySelector(".katex")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add to formula vault" }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe("inputs", () => {
  it("ConfidenceRow is an optional radio group that can be cleared", async () => {
    const onChange = vi.fn();
    const { rerender } = wrap(<ConfidenceRow value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Sure" }));
    expect(onChange).toHaveBeenLastCalledWith("sure");
    rerender(
      <UIProvider>
        <ConfidenceRow value="sure" onChange={onChange} />
      </UIProvider>,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Sure" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("RatingButtons label each rating with its interval", async () => {
    const onRate = vi.fn();
    wrap(<RatingButtons intervals={{ again: "10 min", hard: "1 d", good: "3 d", easy: "8 d" }} onRate={onRate} />, "hi");
    await userEvent.click(screen.getByRole("button", { name: "ठीक, अगला रिव्यू 3 d में" }));
    expect(onRate).toHaveBeenCalledWith("good");
  });

  it("Picker is a native select on web", async () => {
    const onChange = vi.fn();
    wrap(<Picker label="Year" value={null} onChange={onChange} options={[{ value: "2010", label: "2010" }]} />);
    await userEvent.selectOptions(screen.getByLabelText("Year"), "2010");
    expect(onChange).toHaveBeenCalledWith("2010");
  });

  it("TextField: label, hint, error with an icon, counter near the limit", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const r = wrap(<TextField label="Your note" value="" onChange={onChange} hint="Only you see this." onSubmit={onSubmit} testID="note" />);
    const field = r.getByLabelText("Your note");
    fireEvent.change(field, { target: { value: "a cue" } });
    expect(onChange).toHaveBeenCalledWith("a cue");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalled();
    expect(field.getAttribute("aria-describedby")).toBeTruthy();
    r.unmount();
    const e = wrap(<TextField label="Email" value="name@" onChange={vi.fn()} error="Enter an email address." testID="email" />);
    expect(e.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(e.getByTestId("email-error").textContent).toBe("Enter an email address.");
    e.unmount();
    const c = wrap(<TextField label="Details" value={"x".repeat(95)} onChange={vi.fn()} maxLength={100} multiline />);
    expect(c.getByText("5 characters left")).toBeTruthy();
  });

  it("Switch and ChoiceChips", async () => {
    const onSwitch = vi.fn();
    const onChoice = vi.fn();
    wrap(
      <>
        <Switch label="Sound" checked={false} onCheckedChange={onSwitch} />
        <ChoiceChips label="Daily goal" value={["10"]} onChange={onChoice} options={[{ value: "5", label: "5 min" }, { value: "10", label: "10 min" }]} />
      </>,
    );
    await userEvent.click(screen.getByRole("switch", { name: "Sound" }));
    expect(onSwitch).toHaveBeenCalledWith(true);
    expect(screen.getByRole("radio", { name: "10 min" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "5 min" }));
    expect(onChoice).toHaveBeenCalledWith(["5"]);
  });
});

describe("chips and status", () => {
  it("Chip, ProChip and CitationChip", () => {
    wrap(
      <>
        <Chip kind="filter" label="All" selected onPress={() => undefined} />
        <ProChip onPress={() => undefined} />
        <ProChip askGrownUp onPress={() => undefined} />
        <CitationChip examShort="NEET" year={2024} sessionLabel="Main" keyStatus="dropped" onPress={() => undefined} />
      </>,
    );
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Pro. Opens a preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask a grown-up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /From NEET 2024, Main\. Opens source details\. Dropped/ })).toBeInTheDocument();
  });

  it("SaveStateChip shows the four states with text and shortens long emails", () => {
    wrap(
      <>
        <SaveStateChip state="guest" onPress={() => undefined} />
        <SaveStateChip state="saving" />
        <SaveStateChip state="saved" email="aarav.sharma.studies@gmail.com" maxChars={20} />
        <SaveStateChip state="saved_offline" />
      </>,
    );
    expect(screen.getByRole("button", { name: /Only on this phone\. Double-tap/ })).toBeInTheDocument();
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(screen.getByText("Saved to aarav.sha…@gmail.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Saved to aarav.sharma.studies@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("Saved. New progress syncs when online")).toBeInTheDocument();
  });

  it("Meter reads as words; DayDots label each day", () => {
    wrap(
      <>
        <Meter kind="mood" label="Mood" stateWord="Sleepy" value={30} />
        <DayDots label="Quest" days={[{ label: "Mon", state: "done" }, { label: "Tue", state: "today" }]} />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Mood" })).toHaveAttribute("aria-valuetext", "Mood: Sleepy, about a quarter full");
    expect(screen.getByRole("listitem", { name: "Tue, today" })).toBeInTheDocument();
  });

  it("Banner, Toast (auto-dismiss, errors stay) and PetLine", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onErr = vi.fn();
    wrap(
      <>
        <Banner tone="offline" text="Offline." onClose={() => undefined} />
        <Toast open message="Saved" onDismiss={onDismiss} />
        <Toast open tone="error" message="Couldn't save" onDismiss={onErr} />
        <PetLine pet={{ species: "cat" }} petName="Miso" text="Hi there" />
      </>,
    );
    act(() => vi.advanceTimersByTime(4100));
    expect(onDismiss).toHaveBeenCalled();
    expect(onErr).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save");
    expect(screen.getByLabelText("Miso says: Hi there")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("Progress bar, ring and segmented expose values", () => {
    wrap(
      <>
        <ProgressBar value={0.5} label="Goal" />
        <ProgressRing value={0.25} label="Ring" />
        <SegmentedProgress total={8} done={3} label="Lesson" />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Goal" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("progressbar", { name: "Ring" })).toHaveAttribute("aria-valuetext", "25% done");
    expect(screen.getByRole("progressbar", { name: "Lesson" })).toHaveAttribute("aria-valuetext", "3 of 8");
  });
});

describe("settings and pro", () => {
  it("SettingsGroup and rows", async () => {
    const onPress = vi.fn();
    wrap(
      <SettingsGroup title="App">
        <SettingsRow icon="Bell" title="Notifications" value="On" onPress={onPress} />
        <SettingsRow title="Sound" trailing="switch" checked onCheckedChange={() => undefined} />
      </SettingsGroup>,
    );
    expect(screen.getByRole("region", { name: "App" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Sound" })).toHaveAttribute("aria-checked", "true");
  });

  it("a switch row starts its label at the leading edge when it wraps", () => {
    wrap(<SettingsRow title="Let them add friends their teacher approves" trailing="switch" checked={false} onCheckedChange={() => undefined} />);
    const sw = screen.getByRole("switch", { name: /teacher approves/ });
    expect(sw).toHaveClass("text-start");
    expect(sw).not.toHaveClass("text-center");
  });

  it("PriceBlock is live text and TrialTimeline uses real dates", () => {
    wrap(
      <>
        <PriceBlock price="₹1" thenLine="then ₹99/month" />
        <TrialTimeline eligible reminderDate="26 Nov" renewDate="29 Nov" trialPrice="₹1" renewPrice="₹99/month" />
      </>,
    );
    expect(screen.getByText("₹1")).toBeInTheDocument();
    expect(screen.getByText("Today: ₹1")).toBeInTheDocument();
    expect(screen.getByText("26 Nov: we remind you by push and email")).toBeInTheDocument();
    expect(screen.getByText("29 Nov: ₹99/month starts")).toBeInTheDocument();
  });
});

describe("practice and mocks", () => {
  it("MockPaletteCell names its state, never colour alone", () => {
    wrap(<MockPaletteCell number={9} state="answeredMarked" current onPress={() => undefined} />);
    expect(screen.getByRole("button", { name: "Question 9, Answered and marked for review, current question" })).toHaveAttribute("aria-current", "step");
  });

  it("Timer shows warning and final states with icons and announces them", () => {
    const t0 = 1_000_000;
    let now = t0;
    vi.useFakeTimers();
    const { container } = wrap(<Timer mode="countdown" startedAt={t0} endsAt={t0 + 600_000} warnAtMs={300_000} finalAtMs={60_000} now={() => now} />);
    expect(container.querySelector("[data-phase]")).toHaveAttribute("data-phase", "default");
    now = t0 + 400_000;
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector("[data-phase]")).toHaveAttribute("data-phase", "warning");
    expect(screen.getByText(/Time running low/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("SectionTabs locks closed sections", async () => {
    const onSelect = vi.fn();
    wrap(
      <SectionTabs
        activeCode="p"
        onSelect={onSelect}
        sections={[
          { code: "p", title: "Physics", answered: 6, total: 25, state: "open" },
          { code: "c", title: "Chemistry", answered: 0, total: 25, state: "open" },
          { code: "m", title: "Maths", answered: 0, total: 25, state: "locked" },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Maths, 0 of 25 answered, closed" })).toBeDisabled();
    await userEvent.click(screen.getByRole("tab", { name: /Chemistry/ }));
    expect(onSelect).toHaveBeenCalledWith("c");
  });

  it("NumericKeypad builds a value from keys and hardware keys", async () => {
    const onChange = vi.fn();
    wrap(<NumericKeypad value="1" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "decimal point" }));
    expect(onChange).toHaveBeenLastCalledWith("1.");
    fireEvent.keyDown(window, { key: "7" });
    expect(onChange).toHaveBeenLastCalledWith("17");
    await userEvent.click(screen.getByRole("button", { name: "minus" }));
    expect(onChange).toHaveBeenLastCalledWith("-1");
  });

  it("OmrBubbleRow is a radio group per question", async () => {
    const onSelect = vi.fn();
    wrap(<OmrBubbleRow questionNo={12} options={["A", "B", "C", "D"]} selected={1} onSelect={onSelect} flagged />);
    expect(screen.getByRole("radio", { name: "Question 12, option B, filled" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Question 12, option C, empty" }));
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(screen.getByRole("img", { name: "Flagged" })).toBeInTheDocument();
  });

  it("ScoreRing reads negative scores with a minus and an empty ring", () => {
    wrap(<ScoreRing score={-12} max={300} />);
    const ring = screen.getByRole("progressbar");
    expect(ring).toHaveAttribute("aria-valuenow", "0");
    expect(ring).toHaveAttribute("aria-valuetext", "−12 out of 300");
  });

  it("HeatMapCell prints the number and hatches too few answers", () => {
    wrap(
      <>
        <HeatMapCell value={72} count={9} minCount={5} label="Chapter 1" />
        <HeatMapCell value={40} count={2} minCount={5} label="Chapter 2" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Chapter 1: 72% right" })).toHaveTextContent("72%");
    expect(screen.getByRole("img", { name: "Chapter 2: Not enough data" })).toBeInTheDocument();
  });

  it("TimeStrip switches to a table view", async () => {
    wrap(<TimeStrip label="Time" items={[{ questionNo: 1, timeMs: 65_000, targetMs: 60_000, result: "right" }, { questionNo: 2, timeMs: 30_000, result: "wrong" }]} />);
    expect(screen.getByRole("listitem", { name: "Question 1, 1 min 05 s, Right" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("LeaderboardRow shows You for self and Rank soon when pending", () => {
    wrap(
      <>
        <LeaderboardRow rank={3} avatar={{ kind: "pet", species: "cat" }} name="Sunny Sprout 27" score="1,020" />
        <LeaderboardRow rank={14} avatar={{ kind: "pet", species: "dog" }} name="ignored" isSelf score="860" />
        <LeaderboardRow rank={null} rankPending avatar={{ kind: "initials", initials: "AS" }} name="Aarav S." score="—" />
      </>,
    );
    expect(screen.getByLabelText("Rank 3, Sunny Sprout 27, 1,020")).toBeInTheDocument();
    expect(screen.getByLabelText("Rank 14, You, 860")).toBeInTheDocument();
    expect(screen.getByLabelText("Rank Rank soon, Aarav S., —")).toBeInTheDocument();
  });

  it("LimitMeter: last few, full, ask a grown-up, hidden for Pro", () => {
    const { container } = wrap(
      <>
        <LimitMeter label="Free questions" used={27} limit={30} proAction="ask_grown_up" onProPress={() => undefined} />
        <LimitMeter label="Free questions" used={30} limit={30} />
        <LimitMeter label="Hidden" used={1} limit={30} hidden />
      </>,
    );
    expect(screen.getByText("3 left today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask a grown-up" })).toBeInTheDocument();
    expect(screen.getByText("Done for today. Resets at midnight.")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-phase]")).toHaveLength(2);
  });
});

describe("navigation and overlays", () => {
  const items = [
    { key: "learn", label: "Learn", icon: "House" as const },
    { key: "labs", label: "Labs", icon: "Flask" as const },
    { key: "me", label: "Me", icon: "UserCircle" as const },
  ];
  it("TabBar and SidebarNav mark the current page", async () => {
    const onSelect = vi.fn();
    wrap(
      <>
        <TabBar items={items} activeKey="learn" onSelect={onSelect} />
        <SidebarNav items={items} activeKey="labs" onSelect={onSelect} />
      </>,
    );
    const nav = screen.getAllByRole("navigation");
    expect(within(nav[0] as HTMLElement).getByRole("button", { name: "Learn" })).toHaveAttribute("aria-current", "page");
    expect(within(nav[1] as HTMLElement).getByRole("button", { name: "Labs" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(within(nav[0] as HTMLElement).getByRole("button", { name: "Me" }));
    expect(onSelect).toHaveBeenCalledWith("me");
    expect(screen.getByTestId("tab-labs")).toHaveAccessibleName("Labs");
    expect(screen.getByTestId("sidebar-me")).toHaveAccessibleName("Me");
  });

  it("TopBar back button is labelled", () => {
    wrap(<TopBar title="Settings" onBack={() => undefined} />, "hi");
    expect(screen.getByRole("button", { name: "वापस" })).toBeInTheDocument();
  });

  it("Sheet and Dialog open with a title and close", async () => {
    const onOpenChange = vi.fn();
    wrap(
      <>
        <Sheet open onOpenChange={onOpenChange} title="Keep your plant safe">
          <p>Body</p>
        </Sheet>
      </>,
    );
    const dialog = screen.getByRole("dialog", { name: "Keep your plant safe" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Dialog confirm", async () => {
    const onConfirm = vi.fn();
    wrap(<Dialog open onOpenChange={() => undefined} title="Sign out?" confirm={{ label: "Sign out", destructive: true, onPress: onConfirm }} cancel={{ label: "Cancel", onPress: () => undefined }} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe("tutor chat", () => {
  it("ChatBubble: student, system and tutor with the AI label", () => {
    wrap(
      <>
        <ChatBubble role="system" text="Chat started" testID="sys" />
        <ChatBubble role="student" text="Why is the sky blue?" testID="me" />
        <ChatBubble role="tutor" authorName="Mishti" avatar={{ species: "cat" }} text="Light scatters." testID="tutor" />
      </>,
    );
    expect(screen.getByTestId("sys")).toHaveTextContent("Chat started");
    expect(screen.getByTestId("me")).toHaveTextContent("You said: Why is the sky blue?");
    const tutor = screen.getByTestId("tutor");
    expect(within(tutor).getByText("AI")).toBeInTheDocument();
    expect(within(tutor).getByText("Made by AI. It can make mistakes.")).toBeInTheDocument();
  });

  it("ChatBubble: thinking while streaming, announces once when complete", () => {
    const { rerender } = wrap(<ChatBubble role="tutor" authorName="Mishti" streaming testID="t" />);
    expect(screen.getByText("Mishti is thinking…")).toBeInTheDocument();
    expect(screen.queryByText("Made by AI. It can make mistakes.")).not.toBeInTheDocument();
    const ui = (streaming: boolean) => (
      <UIProvider locale="en" assetBaseUrl="https://cdn.example/img/">
        <ChatBubble role="tutor" authorName="Mishti" streaming={streaming} text="Light scatters." citations={<span>NCERT 11</span>} testID="t" />
      </UIProvider>
    );
    rerender(ui(true));
    expect(screen.getByTestId("t").querySelector("[aria-live]")).toHaveTextContent("");
    rerender(ui(false));
    expect(screen.getByTestId("t").querySelector("[aria-live]")).toHaveTextContent("Mishti, AI: Light scatters.");
    expect(screen.getByText("Sources")).toBeInTheDocument();
  });

  it("ChatInput: sends on Enter, counter near the limit, Stop while streaming", async () => {
    const onSend = vi.fn();
    const onChange = vi.fn();
    const { rerender } = wrap(<ChatInput value="" onChange={onChange} onSend={onSend} label="Ask Mishti" maxLength={100} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Ask Mishti" }), "a");
    expect(onChange).toHaveBeenCalledWith("a");
    const ui = (value: string, streaming = false, onStop?: () => void) => (
      <UIProvider locale="en" assetBaseUrl="https://cdn.example/img/">
        <ChatInput value={value} onChange={onChange} onSend={onSend} label="Ask Mishti" maxLength={100} streaming={streaming} onStop={onStop} />
      </UIProvider>
    );
    rerender(ui("x".repeat(85)));
    expect(screen.getByText("15 characters left")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    const onStop = vi.fn();
    rerender(ui("hi", true, onStop));
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("ChatInput: disabled", () => {
    wrap(<ChatInput value="hello" onChange={() => undefined} onSend={() => undefined} label="Ask" disabled />, "hi");
    expect(screen.getByRole("textbox", { name: "Ask" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "भेजें" })).toBeDisabled();
  });
});

describe("social and palace", () => {
  it("FriendRow: status in words, streak, radio selection", async () => {
    const onPress = vi.fn();
    wrap(
      <>
        <FriendRow name="Aarav" avatar={{ species: "dog" }} studiedToday streakDays={12} testID="a" />
        <FriendRow name="Diya" avatar={{ species: "cat" }} studiedToday={false} selectable selected={false} onPress={onPress} />
        <FriendRow name="Kabir" avatar={{ species: "cat" }} selectable disabled note="Not in JEE" />
      </>,
    );
    expect(screen.getByTestId("a")).toHaveTextContent("Studied");
    expect(screen.getByLabelText("12-day streak")).toBeInTheDocument();
    const diya = screen.getByRole("radio", { name: /Diya/ });
    expect(diya).toHaveAttribute("aria-checked", "false");
    expect(diya).toHaveTextContent("Not yet");
    await userEvent.click(diya);
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Kabir/ })).toBeDisabled();
  });

  it("LeagueTierBadge: names come from props, state in the label", () => {
    wrap(
      <>
        <LeagueTierBadge name="Mango" crest="league-05-mango" state="current" />
        <LeagueTierBadge name="Banyan" crest="league-10-banyan" state="future" size="sm" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Mango league crest, current tier" })).toHaveAttribute("data-state", "current");
    expect(screen.getByRole("img", { name: "Banyan league crest, not reached yet" })).toBeInTheDocument();
  });

  it("DuelScoreBar: two rows with scores, solo and dropped", () => {
    const you = { name: "You", avatar: { species: "cat" as const }, score: 30, answers: ["right", "wrong", "open"] as const };
    const { rerender } = wrap(<DuelScoreBar count={5} you={{ ...you, answers: [...you.answers] }} opponent={{ name: "Diya", avatar: { species: "dog" }, score: 20, answers: ["answered", "answered"], dropped: true }} />);
    expect(screen.getByRole("group", { name: "You: 30 points, 2 of 5 answered" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Diya: 20 points, 2 of 5 answered" })).toHaveTextContent("Connection dropped");
    rerender(
      <UIProvider locale="en" assetBaseUrl="https://cdn.example/img/">
        <DuelScoreBar count={5} you={{ ...you, answers: [...you.answers] }} />
      </UIProvider>,
    );
    expect(screen.getByText("Practise solo · not ranked")).toBeInTheDocument();
  });

  it("SquadCard: progress label and press", async () => {
    const onPress = vi.fn();
    wrap(<SquadCard name="Tulsi Squad" crest="squad-crest-tulsi" done={240} target={400} daysLeft={3} onPress={onPress} />);
    const card = screen.getByRole("button", { name: "Tulsi Squad, squad quest, 240 of 400" });
    expect(card).toHaveTextContent("3 days left");
    await userEvent.click(card);
    expect(onPress).toHaveBeenCalled();
  });

  it("CheerButton: reaction counts once, message shows Sent", async () => {
    const onPress = vi.fn();
    const { rerender } = wrap(<CheerButton label="Clap" icon="HandsClapping" count={3} onPress={onPress} />);
    const btn = screen.getByRole("button", { name: "Clap, 3" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(
      <UIProvider locale="en" assetBaseUrl="https://cdn.example/img/">
        <CheerButton label="Clap" icon="HandsClapping" count={4} sent onPress={onPress} />
        <CheerButton kind="message" label="Great streak!" icon="Plant" sent onPress={onPress} />
      </UIProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Clap, 4" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Great streak!/ })).toHaveTextContent("Sent!");
  });

  it("RoomCard: due marker and the two buttons", async () => {
    const onWalk = vi.fn();
    const onQuiz = vi.fn();
    wrap(<RoomCard name="My home" image="palace-room-living" meta="4 rooms · 12 items" due onWalk={onWalk} onQuiz={onQuiz} />, "hi");
    const card = screen.getByRole("article", { name: "My home" });
    expect(card).toHaveTextContent("बाकी");
    await userEvent.click(within(card).getByRole("button", { name: "सैर करें" }));
    await userEvent.click(within(card).getByRole("button", { name: "मुझसे पूछें" }));
    expect(onWalk).toHaveBeenCalled();
    expect(onQuiz).toHaveBeenCalled();
  });

  it("LimitMeter: weekly wording", () => {
    wrap(
      <>
        <LimitMeter label="Sectional mocks" used={1} limit={2} period="week" />
        <LimitMeter label="Sectional mocks" used={2} limit={2} period="week" />
      </>,
    );
    expect(screen.getByText("1 left this week")).toBeInTheDocument();
    expect(screen.getByText("Done for this week.")).toBeInTheDocument();
  });
});

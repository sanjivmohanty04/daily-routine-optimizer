import { useState, useEffect, useRef } from "react";

// ============================================================
// CORE LOGIC MODULES (JavaScript port of Python spec)
// ============================================================

function input_handler(formData) {
  return {
    sleep_hours: parseFloat(formData.sleep_hours) || 7,
    workout_timing: formData.workout_timing || "flexible",
    meals_per_day: parseInt(formData.meals_per_day) || 3,
    hobby_hours: parseFloat(formData.hobby_hours) || 1,
    work_hours: parseFloat(formData.work_hours) || 8,
    goal: formData.goal || "",
    deadline: formData.deadline || "",
  };
}

function compute_days_remaining(deadline) {
  const today = new Date();
  const end = new Date(deadline);
  const diff = Math.max(1, Math.ceil((end - today) / (1000 * 60 * 60 * 24)));
  return diff;
}

function constraint_clamp(inputs) {
  return {
    ...inputs,
    sleep_hours: Math.min(10, Math.max(6, inputs.sleep_hours)),
    work_hours: Math.min(12, Math.max(1, inputs.work_hours)),
    hobby_hours: Math.min(4, Math.max(0, inputs.hobby_hours)),
    meals_per_day: Math.min(5, Math.max(2, inputs.meals_per_day)),
  };
}

function routine_optimizer(inputs, goalAnalysis, days_remaining) {
  const clamped = constraint_clamp(inputs);
  const urgency = Math.max(0, Math.min(1, 1 - days_remaining / 90));

  // Weighted scoring: Health 30%, Productivity 40%, Sustainability 30%
  const goal_hours = Math.min(4, Math.max(0.5, goalAnalysis.daily_effort_hours || 2));
  const workout_duration = urgency > 0.7 ? 0.5 : Math.min(2, Math.max(0.5, 1));

  const total_fixed = clamped.sleep_hours + clamped.work_hours + workout_duration + clamped.hobby_hours + goal_hours;
  const meal_time = clamped.meals_per_day * 0.33;
  const buffer = Math.max(0, 24 - total_fixed - meal_time);

  // Suggest sleep/wake times
  const wake_hour = 6;
  const sleep_hour = wake_hour + clamped.sleep_hours + (24 - clamped.sleep_hours - wake_hour > 16 ? 0 : 0);
  const actual_sleep = 24 - (wake_hour + (24 - clamped.sleep_hours));

  // Workout timing
  const workout_start =
    clamped.workout_timing === "morning" ? wake_hour + 0.5
    : clamped.workout_timing === "evening" ? 18
    : urgency > 0.5 ? wake_hour + 0.5 : 18;

  // Meal timing distribution
  const meal_times = [];
  for (let i = 0; i < clamped.meals_per_day; i++) {
    const t = 7 + (i * (20 - 7)) / Math.max(1, clamped.meals_per_day - 1);
    meal_times.push(formatTime(t));
  }

  const difficulty_score = Math.round(
    (urgency * 40 + (goal_hours / 4) * 30 + (clamped.work_hours / 12) * 30)
  );

  return {
    sleep: {
      duration_hours: clamped.sleep_hours,
      wake_time: formatTime(wake_hour),
      sleep_time: formatTime(24 - clamped.sleep_hours + wake_hour > 24 ? 22 : wake_hour + 16),
    },
    workout: {
      duration_hours: workout_duration,
      start_time: formatTime(workout_start),
      timing_preference: clamped.workout_timing,
    },
    meals: {
      count: clamped.meals_per_day,
      times: meal_times,
    },
    hobbies: {
      duration_hours: clamped.hobby_hours,
      note: urgency > 0.8 ? "Slightly reduced to focus on goal" : "As preferred",
    },
    work: {
      duration_hours: clamped.work_hours,
      goal_work_hours: parseFloat(goal_hours.toFixed(1)),
    },
    meta: {
      urgency_score: parseFloat(urgency.toFixed(2)),
      difficulty_score,
      days_remaining,
      free_buffer_hours: parseFloat(buffer.toFixed(1)),
    },
  };
}

function adherence_tracker(history) {
  const streak = history.reduceRight((acc, d) => {
    if (!acc.done && d.adherence >= 0.8) return { count: acc.count + 1, done: false };
    return { ...acc, done: true };
  }, { count: 0, done: false });

  const avg = history.length
    ? history.reduce((s, d) => s + d.adherence, 0) / history.length
    : 1;

  return { streak: streak.count, avg_adherence: parseFloat(avg.toFixed(2)) };
}

function adaptive_scheduler(routine, adherence_score, missed_tasks, days_remaining) {
  const deficit = 1 - adherence_score;
  const extra_goal = parseFloat((routine.work.goal_work_hours * deficit * 0.5).toFixed(1));
  const adjusted_goal = Math.min(5, routine.work.goal_work_hours + extra_goal);
  const urgency_bump = Math.min(0.2, deficit * 0.3);

  return {
    ...routine,
    work: {
      ...routine.work,
      goal_work_hours: adjusted_goal,
    },
    meta: {
      ...routine.meta,
      urgency_score: Math.min(1, routine.meta.urgency_score + urgency_bump),
      difficulty_score: Math.min(100, routine.meta.difficulty_score + Math.round(urgency_bump * 30)),
      adjustment_note: deficit > 0.2
        ? `+${extra_goal}h goal work redistributed from missed tasks: ${missed_tasks.join(", ")}`
        : "On track — no adjustment needed",
    },
  };
}

function formatTime(decimalHour) {
  const h = Math.floor(decimalHour) % 24;
  const m = Math.round((decimalHour % 1) * 60);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

// ============================================================
// AI API CALLS
// ============================================================

async function goal_analyzer(goal, deadline, days_remaining) {
  const prompt = `You are a productivity and life-coaching AI. A user has a goal with a deadline.

Goal: "${goal}"
Deadline: ${deadline} (${days_remaining} days from today)

Analyze this goal and return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "goal_summary": "one sentence summary",
  "daily_effort_hours": <number between 0.5 and 4, how many focused hours per day needed>,
  "key_tasks": ["task1", "task2", "task3"],
  "milestones": [
    {"day": <day number>, "milestone": "description"}
  ],
  "tips": ["tip1", "tip2"]
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.map(b => b.text || "").join("") || "{}";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { goal_summary: goal, daily_effort_hours: 2, key_tasks: [], milestones: [], tips: [] };
  }
}

async function generate_routine_with_ai(inputs, goalAnalysis, routine, day_number) {
  const prompt = `You are a daily routine optimizer AI. Generate a detailed hourly schedule for Day ${day_number}.

User Profile:
- Sleep: ${inputs.sleep_hours}h
- Work: ${inputs.work_hours}h/day
- Workout: ${inputs.workout_timing}
- Meals: ${inputs.meals_per_day}/day
- Hobbies: ${inputs.hobby_hours}h

Goal: ${inputs.goal}
Days Remaining: ${routine.meta.days_remaining}
Urgency: ${(routine.meta.urgency_score * 100).toFixed(0)}%
Daily Goal Work Required: ${routine.work.goal_work_hours}h
Key Tasks: ${goalAnalysis.key_tasks?.join(", ") || "N/A"}

Return ONLY valid JSON:
{
  "schedule": [
    {"time": "HH:MM AM/PM", "activity": "...", "duration_min": <number>, "category": "sleep|work|goal|workout|meal|hobby|buffer"}
  ],
  "daily_focus": "one motivating sentence for today",
  "priority_task": "the single most important thing to do today"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.map(b => b.text || "").join("") || "{}";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { schedule: [], daily_focus: "Stay focused.", priority_task: "Work on your goal." };
  }
}

async function adapt_plan_with_ai(inputs, routine, adherence, missed, day_number) {
  const prompt = `A user missed part of their routine. Adapt tomorrow's plan.

Adherence today: ${(adherence * 100).toFixed(0)}%
Missed tasks: ${missed.join(", ") || "none"}
Days remaining to goal: ${routine.meta.days_remaining - 1}
Original daily goal work: ${routine.work.goal_work_hours}h
Adjusted goal work: ${routine.work.goal_work_hours + (1 - adherence) * 0.5}h

Return ONLY valid JSON:
{
  "adjustment_summary": "brief explanation of changes",
  "motivation_message": "encouraging message for the user",
  "tomorrow_focus": "what to prioritize tomorrow",
  "intensity_increase": <percentage 0-20>
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.map(b => b.text || "").join("") || "{}";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return {
      adjustment_summary: "Minor adjustments made.",
      motivation_message: "Keep going!",
      tomorrow_focus: "Goal work",
      intensity_increase: 5,
    };
  }
}

// ============================================================
// UI COMPONENTS
// ============================================================

const CATEGORY_COLORS = {
  sleep: "#6366f1",
  work: "#f59e0b",
  goal: "#10b981",
  workout: "#ef4444",
  meal: "#8b5cf6",
  hobby: "#06b6d4",
  buffer: "#6b7280",
};

const CATEGORY_ICONS = {
  sleep: "🌙",
  work: "💼",
  goal: "🎯",
  workout: "💪",
  meal: "🍽️",
  hobby: "🎨",
  buffer: "☕",
};

function ProgressRing({ value, size = 80, stroke = 8, color = "#10b981" }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - value);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
        strokeWidth={stroke} strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

function DifficultyBadge({ score }) {
  const color = score < 40 ? "#10b981" : score < 70 ? "#f59e0b" : "#ef4444";
  const label = score < 40 ? "Easy" : score < 70 ? "Moderate" : "Intense";
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 700, letterSpacing: 1
    }}>
      {label} {score}/100
    </span>
  );
}

function ScheduleBlock({ item, index }) {
  const color = CATEGORY_COLORS[item.category] || "#6b7280";
  const icon = CATEGORY_ICONS[item.category] || "⏱️";
  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "flex-start",
      padding: "10px 0", borderBottom: "1px solid #0f172a",
      animation: `fadeUp 0.3s ease ${index * 0.04}s both`
    }}>
      <div style={{
        minWidth: 8, height: 8, borderRadius: "50%", background: color,
        marginTop: 6, boxShadow: `0 0 8px ${color}`
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>
            {icon} {item.activity}
          </span>
          <span style={{ color: "#64748b", fontSize: 11 }}>{item.duration_min}min</span>
        </div>
        <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>{item.time}</div>
      </div>
    </div>
  );
}

function RoutineCard({ routine, aiDay, day, label }) {
  if (!routine) return null;
  const { sleep, workout, meals, hobbies, work, meta } = routine;

  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16,
      padding: 24, display: "flex", flexDirection: "column", gap: 16
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>{label}</div>
          <div style={{ color: "#f1f5f9", fontSize: 20, fontWeight: 800, fontFamily: "'Syne', sans-serif" }}>Day {day}</div>
        </div>
        <DifficultyBadge score={meta.difficulty_score} />
      </div>

      {/* Focus */}
      {aiDay?.daily_focus && (
        <div style={{
          background: "#10b98115", border: "1px solid #10b98133", borderRadius: 10,
          padding: "10px 14px", color: "#34d399", fontSize: 13, fontStyle: "italic"
        }}>
          "{aiDay.daily_focus}"
        </div>
      )}

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {[
          { label: "Sleep", val: `${sleep.duration_hours}h`, sub: `Wake ${sleep.wake_time}`, color: "#6366f1" },
          { label: "Work", val: `${work.duration_hours}h`, sub: `+${work.goal_work_hours}h goal`, color: "#f59e0b" },
          { label: "Workout", val: `${workout.duration_hours}h`, sub: workout.start_time, color: "#ef4444" },
          { label: "Meals", val: `${meals.count}x`, sub: meals.times[0], color: "#8b5cf6" },
          { label: "Hobby", val: `${hobbies.duration_hours}h`, sub: hobbies.note, color: "#06b6d4" },
          { label: "Buffer", val: `${meta.free_buffer_hours}h`, sub: "free time", color: "#6b7280" },
        ].map(s => (
          <div key={s.label} style={{
            background: "#1e293b", borderRadius: 10, padding: "10px 12px",
            borderLeft: `3px solid ${s.color}`
          }}>
            <div style={{ color: "#94a3b8", fontSize: 10, letterSpacing: 1 }}>{s.label.toUpperCase()}</div>
            <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 16 }}>{s.val}</div>
            <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Priority task */}
      {aiDay?.priority_task && (
        <div style={{
          background: "#f59e0b11", border: "1px solid #f59e0b33", borderRadius: 10,
          padding: "10px 14px", display: "flex", gap: 8, alignItems: "center"
        }}>
          <span style={{ fontSize: 16 }}>🎯</span>
          <div>
            <div style={{ color: "#94a3b8", fontSize: 10, letterSpacing: 1 }}>TODAY'S PRIORITY</div>
            <div style={{ color: "#fbbf24", fontSize: 13, fontWeight: 600 }}>{aiDay.priority_task}</div>
          </div>
        </div>
      )}

      {/* Schedule */}
      {aiDay?.schedule?.length > 0 && (
        <div>
          <div style={{ color: "#475569", fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>HOURLY SCHEDULE</div>
          <div style={{ maxHeight: 260, overflowY: "auto", paddingRight: 4 }}>
            {aiDay.schedule.map((item, i) => <ScheduleBlock key={i} item={item} index={i} />)}
          </div>
        </div>
      )}

      {/* Urgency bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontSize: 11 }}>Urgency Level</span>
          <span style={{ color: "#94a3b8", fontSize: 11 }}>{(meta.urgency_score * 100).toFixed(0)}%</span>
        </div>
        <div style={{ background: "#1e293b", borderRadius: 99, height: 6 }}>
          <div style={{
            height: 6, borderRadius: 99, width: `${meta.urgency_score * 100}%`,
            background: meta.urgency_score > 0.7 ? "#ef4444" : meta.urgency_score > 0.4 ? "#f59e0b" : "#10b981",
            transition: "width 0.8s ease"
          }} />
        </div>
      </div>

      {/* Adjustment note */}
      {meta.adjustment_note && (
        <div style={{
          background: "#ef444411", border: "1px solid #ef444433", borderRadius: 10,
          padding: "8px 14px", color: "#fca5a5", fontSize: 12
        }}>
          ⚠️ {meta.adjustment_note}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================

export default function App() {
  const [step, setStep] = useState("form"); // form | loading | results | simulate
  const [form, setForm] = useState({
    sleep_hours: "7", workout_timing: "morning", meals_per_day: "3",
    hobby_hours: "1", work_hours: "8", goal: "", deadline: ""
  });
  const [loadingMsg, setLoadingMsg] = useState("");
  const [data, setData] = useState(null);
  const [simDay, setSimDay] = useState(0);
  const [simState, setSimState] = useState(null);
  const [simHistory, setSimHistory] = useState([]);
  const [adherenceInput, setAdherenceInput] = useState(100);
  const [missedInput, setMissedInput] = useState("");
  const [simLoading, setSimLoading] = useState(false);

  const messages = [
    "Analyzing your goal...", "Decomposing into daily tasks...",
    "Optimizing your routine...", "Building your schedule..."
  ];
  const msgIdx = useRef(0);

  async function handleSubmit() {
    setStep("loading");
    const inputs = input_handler(form);
    const days_rem = compute_days_remaining(inputs.deadline);

    // Cycle loading messages
    const iv = setInterval(() => {
      msgIdx.current = (msgIdx.current + 1) % messages.length;
      setLoadingMsg(messages[msgIdx.current]);
    }, 1400);
    setLoadingMsg(messages[0]);

    try {
      const goalAnalysis = await goal_analyzer(inputs.goal, inputs.deadline, days_rem);
      const routine = routine_optimizer(inputs, goalAnalysis, days_rem);
      const aiDay = await generate_routine_with_ai(inputs, goalAnalysis, routine, 1);

      clearInterval(iv);
      setData({ inputs, goalAnalysis, routine, aiDay, days_rem });
      setSimState({ inputs, goalAnalysis, routine, aiDay, days_rem, day: 1 });
      setSimDay(1);
      setStep("results");
    } catch (e) {
      clearInterval(iv);
      setLoadingMsg("Error: " + e.message);
    }
  }

  async function handleAdherence() {
    if (!simState) return;
    setSimLoading(true);
    const adherence = adherenceInput / 100;
    const missed = missedInput.split(",").map(s => s.trim()).filter(Boolean);

    // Update tracker
    const newHistory = [...simHistory, { day: simState.day, adherence }];
    setSimHistory(newHistory);

    // Adapt
    const adaptedRoutine = adaptive_scheduler(simState.routine, adherence, missed, simState.days_rem);
    const aiAdapt = await adapt_plan_with_ai(simState.inputs, adaptedRoutine, adherence, missed, simState.day);

    const newDaysRem = Math.max(1, simState.days_rem - 1);
    const newRoutine = {
      ...adaptedRoutine,
      meta: {
        ...adaptedRoutine.meta,
        days_remaining: newDaysRem,
        adjustment_note: aiAdapt.adjustment_summary,
      }
    };
    const newAiDay = await generate_routine_with_ai(simState.inputs, simState.goalAnalysis, newRoutine, simState.day + 1);

    setSimState({
      ...simState,
      routine: newRoutine,
      aiDay: { ...newAiDay, aiAdapt },
      days_rem: newDaysRem,
      day: simState.day + 1,
      lastAdherence: adherence,
      lastMissed: missed,
    });
    setSimDay(d => d + 1);
    setMissedInput("");
    setAdherenceInput(100);
    setSimLoading(false);
  }

  const trackerStats = adherence_tracker(simHistory);

  // ---- RENDER ----

  if (step === "form") {
    return (
      <div style={{
        minHeight: "100vh", background: "#020817",
        fontFamily: "'Inter', sans-serif", color: "#e2e8f0",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap');
          @keyframes fadeUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
          input,select { outline:none; }
          input:focus, select:focus { border-color: #6366f1 !important; }
          ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:#0f172a; } ::-webkit-scrollbar-thumb { background:#334155; border-radius:99px; }
        `}</style>

        <div style={{ width: "100%", maxWidth: 560, animation: "fadeUp 0.5s ease" }}>
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              background: "#6366f122", border: "1px solid #6366f144", borderRadius: 99,
              padding: "6px 18px", marginBottom: 20
            }}>
              <span style={{ fontSize: 18 }}>⚡</span>
              <span style={{ color: "#a5b4fc", fontSize: 12, letterSpacing: 3, fontWeight: 600 }}>AI-POWERED</span>
            </div>
            <h1 style={{
              fontFamily: "'Syne', sans-serif", fontSize: 40, fontWeight: 800,
              background: "linear-gradient(135deg, #f1f5f9 0%, #94a3b8 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              margin: 0, lineHeight: 1.1
            }}>
              Daily Routine<br />Optimizer
            </h1>
            <p style={{ color: "#475569", fontSize: 14, marginTop: 12 }}>
              Tell us your lifestyle. We'll build your perfect day.
            </p>
          </div>

          {/* Form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { key: "sleep_hours", label: "Sleep Hours/Day", type: "number", min: 4, max: 10, step: 0.5 },
                { key: "work_hours", label: "Work Hours/Day", type: "number", min: 1, max: 12, step: 0.5 },
                { key: "hobby_hours", label: "Hobby Hours/Day", type: "number", min: 0, max: 6, step: 0.5 },
                { key: "meals_per_day", label: "Meals Per Day", type: "number", min: 2, max: 5, step: 1 },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ color: "#64748b", fontSize: 11, letterSpacing: 1, display: "block", marginBottom: 6 }}>
                    {f.label.toUpperCase()}
                  </label>
                  <input
                    type={f.type} value={form[f.key]} min={f.min} max={f.max} step={f.step}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    style={{
                      width: "100%", background: "#0f172a", border: "1px solid #1e293b",
                      borderRadius: 10, padding: "10px 14px", color: "#e2e8f0", fontSize: 14,
                      boxSizing: "border-box", transition: "border-color 0.2s"
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Workout timing */}
            <div>
              <label style={{ color: "#64748b", fontSize: 11, letterSpacing: 1, display: "block", marginBottom: 6 }}>
                WORKOUT TIMING
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {["morning", "evening", "flexible"].map(t => (
                  <button key={t} onClick={() => setForm(p => ({ ...p, workout_timing: t }))}
                    style={{
                      flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid",
                      borderColor: form.workout_timing === t ? "#6366f1" : "#1e293b",
                      background: form.workout_timing === t ? "#6366f122" : "#0f172a",
                      color: form.workout_timing === t ? "#a5b4fc" : "#64748b",
                      cursor: "pointer", fontSize: 13, fontWeight: 600,
                      textTransform: "capitalize", transition: "all 0.2s"
                    }}>
                    {t === "morning" ? "🌅" : t === "evening" ? "🌆" : "🔄"} {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Goal */}
            <div>
              <label style={{ color: "#64748b", fontSize: 11, letterSpacing: 1, display: "block", marginBottom: 6 }}>
                YOUR GOAL
              </label>
              <textarea
                value={form.goal} rows={3}
                placeholder="e.g. Learn machine learning and build a portfolio project"
                onChange={e => setForm(p => ({ ...p, goal: e.target.value }))}
                style={{
                  width: "100%", background: "#0f172a", border: "1px solid #1e293b",
                  borderRadius: 10, padding: "12px 14px", color: "#e2e8f0", fontSize: 14,
                  boxSizing: "border-box", resize: "vertical", fontFamily: "inherit",
                  transition: "border-color 0.2s"
                }}
              />
            </div>

            {/* Deadline */}
            <div>
              <label style={{ color: "#64748b", fontSize: 11, letterSpacing: 1, display: "block", marginBottom: 6 }}>
                GOAL DEADLINE
              </label>
              <input
                type="date" value={form.deadline}
                min={new Date().toISOString().split("T")[0]}
                onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))}
                style={{
                  width: "100%", background: "#0f172a", border: "1px solid #1e293b",
                  borderRadius: 10, padding: "10px 14px", color: "#e2e8f0", fontSize: 14,
                  boxSizing: "border-box", colorScheme: "dark"
                }}
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={!form.goal || !form.deadline}
              style={{
                marginTop: 8, padding: "14px 0", borderRadius: 12, border: "none",
                background: form.goal && form.deadline
                  ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "#1e293b",
                color: form.goal && form.deadline ? "#fff" : "#475569",
                fontSize: 15, fontWeight: 700, cursor: form.goal && form.deadline ? "pointer" : "not-allowed",
                fontFamily: "'Syne', sans-serif", letterSpacing: 0.5,
                transition: "all 0.2s", boxShadow: form.goal && form.deadline ? "0 0 30px #6366f144" : "none"
              }}>
              Generate My Optimized Routine ⚡
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "loading") {
    return (
      <div style={{
        minHeight: "100vh", background: "#020817", display: "flex",
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20
      }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
        <div style={{
          width: 60, height: 60, border: "3px solid #1e293b",
          borderTop: "3px solid #6366f1", borderRadius: "50%",
          animation: "spin 1s linear infinite"
        }} />
        <div style={{ color: "#94a3b8", fontSize: 14, animation: "pulse 1.4s ease infinite" }}>
          {loadingMsg}
        </div>
      </div>
    );
  }

  if (step === "results" || step === "simulate") {
    const { goalAnalysis, days_rem } = data;

    return (
      <div style={{ minHeight: "100vh", background: "#020817", fontFamily: "'Inter', sans-serif", color: "#e2e8f0" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap');
          @keyframes fadeUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
          @keyframes spin { to { transform:rotate(360deg) } }
          ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:#0f172a; } ::-webkit-scrollbar-thumb { background:#334155; border-radius:99px; }
        `}</style>

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32, flexWrap: "wrap", gap: 16 }}>
            <div>
              <button onClick={() => setStep("form")} style={{
                background: "none", border: "1px solid #1e293b", borderRadius: 8,
                color: "#64748b", cursor: "pointer", padding: "6px 12px", fontSize: 12, marginBottom: 12
              }}>← Back</button>
              <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, margin: 0, color: "#f1f5f9" }}>
                Your Optimized Routine
              </h1>
              <p style={{ color: "#475569", fontSize: 13, marginTop: 6 }}>
                {days_rem} days to goal · {goalAnalysis.goal_summary}
              </p>
            </div>

            {/* Streak + Avg */}
            {simHistory.length > 0 && (
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{
                  background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
                  padding: "12px 20px", textAlign: "center"
                }}>
                  <div style={{ color: "#f59e0b", fontSize: 22, fontWeight: 800 }}>🔥 {trackerStats.streak}</div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>Day Streak</div>
                </div>
                <div style={{
                  background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
                  padding: "12px 20px", textAlign: "center"
                }}>
                  <div style={{ color: "#10b981", fontSize: 22, fontWeight: 800 }}>
                    {(trackerStats.avg_adherence * 100).toFixed(0)}%
                  </div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>Avg Adherence</div>
                </div>
              </div>
            )}
          </div>

          {/* Goal info cards */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12, marginBottom: 32
          }}>
            {goalAnalysis.key_tasks?.map((task, i) => (
              <div key={i} style={{
                background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
                padding: "14px 16px", display: "flex", gap: 10, alignItems: "flex-start"
              }}>
                <div style={{
                  width: 24, height: 24, background: "#10b98122", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#34d399", fontSize: 12, fontWeight: 700, flexShrink: 0
                }}>{i + 1}</div>
                <span style={{ color: "#cbd5e1", fontSize: 13 }}>{task}</span>
              </div>
            ))}
          </div>

          {/* Simulate section */}
          <div style={{
            background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16,
            padding: 24, marginBottom: 24
          }}>
            <div style={{ color: "#94a3b8", fontSize: 11, letterSpacing: 2, marginBottom: 12 }}>
              DAILY FEEDBACK LOOP — DAY {simState?.day || 1}
            </div>

            {simHistory.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {simHistory.map((h, i) => (
                  <div key={i} style={{
                    background: h.adherence >= 0.8 ? "#10b98122" : "#ef444422",
                    border: `1px solid ${h.adherence >= 0.8 ? "#10b98144" : "#ef444444"}`,
                    borderRadius: 8, padding: "6px 12px", fontSize: 12,
                    color: h.adherence >= 0.8 ? "#34d399" : "#fca5a5"
                  }}>
                    Day {h.day}: {(h.adherence * 100).toFixed(0)}%
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={{ color: "#64748b", fontSize: 11, letterSpacing: 1, display: "block", marginBottom: 6 }}>
                  TODAY'S ADHERENCE (%)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="range" min={0} max={100} value={adherenceInput}
                    onChange={e => setAdherenceInput(Number(e.target.value))}
                    style={{ width: 140, accentColor: "#6366f1" }}
                  />
                  <span style={{ color: "#a5b4fc", fontWeight: 700, fontSize: 18, minWidth: 40 }}>
                    {adherenceInput}%
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={{ color: "#64748b", fontSize: 11, letterSpacing: 1, display: "block", marginBottom: 6 }}>
                  MISSED TASKS (comma-separated)
                </label>
                <input
                  value={missedInput} onChange={e => setMissedInput(e.target.value)}
                  placeholder="e.g. workout, goal study"
                  style={{
                    width: "100%", background: "#020817", border: "1px solid #1e293b",
                    borderRadius: 10, padding: "10px 14px", color: "#e2e8f0", fontSize: 13,
                    boxSizing: "border-box"
                  }}
                />
              </div>
              <button
                onClick={handleAdherence} disabled={simLoading}
                style={{
                  padding: "11px 22px", borderRadius: 10, border: "none",
                  background: simLoading ? "#1e293b" : "linear-gradient(135deg, #10b981, #059669)",
                  color: simLoading ? "#475569" : "#fff", cursor: simLoading ? "not-allowed" : "pointer",
                  fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8
                }}>
                {simLoading
                  ? <><span style={{ width: 14, height: 14, border: "2px solid #475569", borderTop: "2px solid #94a3b8", borderRadius: "50%", display: "inline-block", animation: "spin 1s linear infinite" }} /> Adapting...</>
                  : "→ Next Day"
                }
              </button>
            </div>

            {simState?.aiDay?.aiAdapt && (
              <div style={{
                marginTop: 16, background: "#020817", border: "1px solid #334155",
                borderRadius: 10, padding: "12px 16px"
              }}>
                <div style={{ color: "#94a3b8", fontSize: 11, letterSpacing: 1, marginBottom: 6 }}>AI COACH</div>
                <div style={{ color: "#34d399", fontSize: 13 }}>💬 {simState.aiDay.aiAdapt.motivation_message}</div>
                <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                  {simState.aiDay.aiAdapt.adjustment_summary}
                </div>
              </div>
            )}
          </div>

          {/* Routine cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
            {simState && (
              <RoutineCard
                routine={simState.routine}
                aiDay={simState.aiDay}
                day={simState.day}
                label={simState.day === 1 ? "Current Day" : `Day ${simState.day} — Adapted`}
              />
            )}
          </div>

          {/* Tips */}
          {goalAnalysis.tips?.length > 0 && (
            <div style={{
              marginTop: 24, background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 16, padding: 24
            }}>
              <div style={{ color: "#94a3b8", fontSize: 11, letterSpacing: 2, marginBottom: 16 }}>💡 AI TIPS</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                {goalAnalysis.tips.map((tip, i) => (
                  <div key={i} style={{
                    background: "#1e293b", borderRadius: 10, padding: "12px 16px",
                    color: "#cbd5e1", fontSize: 13, borderLeft: "3px solid #6366f1"
                  }}>
                    {tip}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

//! Calendar arithmetic on local `YYYY-MM-DD` strings (schema v8: recurrence, goal periods, habit weeks).
//!
//! Everything here works on civil dates, never on instants, so daylight-saving changes cannot move a date.
//! Callers pass "today" in explicitly, which keeps every rule deterministic and testable.

/// Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's algorithm).
pub fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y as i64 - 1 } else { y as i64 };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

pub fn is_leap(y: i32) -> bool {
    y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)
}

pub fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
    }
}

/// Splits a date that already passed `productivity::valid_date`.
pub fn parts(date: &str) -> (i32, u32, u32) {
    (
        date[0..4].parse().unwrap_or(2000),
        date[5..7].parse().unwrap_or(1),
        date[8..10].parse().unwrap_or(1),
    )
}

pub fn format(y: i32, m: u32, d: u32) -> String {
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn to_days(date: &str) -> i64 {
    let (y, m, d) = parts(date);
    days_from_civil(y, m, d)
}

pub fn from_days(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format(y, m, d)
}

pub fn add_days(date: &str, n: i64) -> String {
    from_days(to_days(date) + n)
}

/// 0 = Monday … 6 = Sunday.
pub fn weekday(date: &str) -> u32 {
    (to_days(date) + 3).rem_euclid(7) as u32
}

/// The Monday on or before `date`. Weeks run Monday to Sunday, like the Calendar and the Study goals.
pub fn week_start(date: &str) -> String {
    add_days(date, -(weekday(date) as i64))
}

pub fn month_start(date: &str) -> String {
    let (y, m, _) = parts(date);
    format(y, m, 1)
}

/// A monthly responsibility on day 29, 30 or 31 falls on the last day of shorter months
/// (31st -> Feb 28/29, Apr 30). The deadline never skips a month and never spills into the next one.
pub fn monthly_day(y: i32, m: u32, wanted: u32) -> u32 {
    wanted.min(days_in_month(y, m))
}

/// Dates in `[from, to]` (inclusive, already clipped by the caller to a small window) on which a rule fires.
/// `weekdays` use 0 = Monday. `month_day` is 1–31.
pub fn rule_dates(
    frequency: &str,
    weekdays: &[u32],
    month_day: u32,
    start: &str,
    end: Option<&str>,
    from: &str,
    to: &str,
) -> Vec<String> {
    let first = if from > start { from } else { start };
    let last = match end {
        Some(e) if e < to => e,
        _ => to,
    };
    let mut out = Vec::new();
    if first > last {
        return out;
    }
    for day in to_days(first)..=to_days(last) {
        let (y, m, d) = civil_from_days(day);
        let fires = match frequency {
            "daily" => true,
            "weekly" => weekdays.contains(&((day + 3).rem_euclid(7) as u32)),
            "monthly" => d == monthly_day(y, m, month_day),
            _ => false,
        };
        if fires {
            out.push(format(y, m, d));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_round_trip_and_weekdays() {
        assert_eq!(from_days(0), "1970-01-01");
        assert_eq!(weekday("1970-01-01"), 3); // Thursday
        assert_eq!(weekday("2026-11-02"), 0); // Monday
        assert_eq!(weekday("2024-02-29"), 3); // Thursday, leap day
        for days in [-800_000i64, -1, 0, 19_000, 40_000, 2_932_896] {
            assert_eq!(to_days(&from_days(days)), days);
        }
    }

    #[test]
    fn month_and_year_boundaries() {
        assert_eq!(add_days("2026-12-31", 1), "2027-01-01");
        assert_eq!(add_days("2024-02-28", 1), "2024-02-29");
        assert_eq!(add_days("2025-02-28", 1), "2025-03-01");
        assert_eq!(add_days("2026-03-01", -1), "2026-02-28");
        assert_eq!(week_start("2026-11-01"), "2026-10-26"); // Sunday belongs to the week that began Monday 26 Oct
        assert_eq!(week_start("2026-11-02"), "2026-11-02");
        assert_eq!(month_start("2026-11-17"), "2026-11-01");
    }

    #[test]
    fn monthly_day_is_clamped_to_the_last_day_of_short_months() {
        assert_eq!(monthly_day(2025, 2, 31), 28);
        assert_eq!(monthly_day(2024, 2, 30), 29);
        assert_eq!(monthly_day(2026, 4, 31), 30);
        assert_eq!(monthly_day(2026, 1, 31), 31);
        let dates = rule_dates(
            "monthly",
            &[],
            31,
            "2026-01-01",
            None,
            "2026-01-01",
            "2026-05-31",
        );
        assert_eq!(
            dates,
            vec![
                "2026-01-31",
                "2026-02-28",
                "2026-03-31",
                "2026-04-30",
                "2026-05-31"
            ]
        );
        let leap = rule_dates(
            "monthly",
            &[],
            29,
            "2024-01-01",
            None,
            "2024-02-01",
            "2024-03-31",
        );
        assert_eq!(leap, vec!["2024-02-29", "2024-03-29"]);
        let common = rule_dates(
            "monthly",
            &[],
            29,
            "2025-01-01",
            None,
            "2025-02-01",
            "2025-03-31",
        );
        assert_eq!(common, vec!["2025-02-28", "2025-03-29"]);
    }

    #[test]
    fn weekly_and_daily_rules_respect_start_end_and_window() {
        let tuesdays = rule_dates(
            "weekly",
            &[1],
            1,
            "2026-10-01",
            None,
            "2026-10-26",
            "2026-11-15",
        );
        assert_eq!(tuesdays, vec!["2026-10-27", "2026-11-03", "2026-11-10"]);
        let ended = rule_dates(
            "daily",
            &[],
            1,
            "2026-10-01",
            Some("2026-10-28"),
            "2026-10-26",
            "2026-11-15",
        );
        assert_eq!(ended, vec!["2026-10-26", "2026-10-27", "2026-10-28"]);
        let not_started = rule_dates(
            "daily",
            &[],
            1,
            "2026-11-10",
            None,
            "2026-11-01",
            "2026-11-11",
        );
        assert_eq!(not_started, vec!["2026-11-10", "2026-11-11"]);
        assert!(rule_dates(
            "daily",
            &[],
            1,
            "2026-10-01",
            Some("2026-10-02"),
            "2026-11-01",
            "2026-11-05"
        )
        .is_empty());
        // The clocks change on 2026-11-01 (US) and 2026-03-29 (EU): dates are civil, so every day appears exactly once.
        assert_eq!(
            rule_dates(
                "daily",
                &[],
                1,
                "2026-10-30",
                None,
                "2026-10-30",
                "2026-11-03"
            )
            .len(),
            5
        );
    }
}

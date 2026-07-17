# Flag Paths — Founding Community Strategy

Status: working proposal  
Date: 2026-07-17  
Inputs: current product, founder handoff, and `.agents/product-marketing.md`

## The strategic call

Build the profile and monitoring product now; use community as a lightweight,
opt-in layer around real routes and reviewed changes.

The first milestone is not a large public chat or a full account system. It is a private
mobility profile that reaches one personalized route, lets the user watch it, and later
delivers reviewed changes. A small, deliberately recruited group can then prove whether
people will repeatedly help one another discover, verify, and progress those routes.

## Community identity and promise

**Working identity:** Global option-builders.

Members are not defined only by using Flag Paths. They are people deliberately
building more geographic choice for themselves and their families.

**Member promise:** Make smarter cross-border moves with people who are researching,
attempting, or have completed the routes.

**What members get first:**

- Practical route knowledge and lived experience that a static map cannot provide.
- Help pressure-testing a plan before paying for professional advice.
- Early access to new planner capabilities and influence over the roadmap.
- Recognition for useful sources, corrections, field notes, and completed routes.
- A peer group that understands the long timelines and uncertainty involved.

## The core loop

1. A member posts a goal, route question, source, correction, or field note.
2. Other members compare experience and evidence.
3. A useful claim is verified or clearly labelled as anecdotal.
4. Verified knowledge improves the atlas, tests, or public research notes.
5. The contributor is credited and the change is shared back with the community.
6. Better public knowledge attracts the next member with a related goal.

The weekly behavior to design around is: **help advance one real route**.

## Platform choice

**Recommended pilot:** Telegram, split into three deliberately separate surfaces:

- A broadcast channel for verified rule changes and product updates.
- A private or invite-only discussion group, organized with topics, for the first
  20–30 members.
- A private bot for profile-specific route alerts once monitoring is live.

GitHub remains the structured contribution and audit trail.

Why Telegram for the pilot:

- The immediate loop is profile → private alert → optional discussion.
- Notifications and direct bot delivery fit reviewed status-change monitoring.
- Topics can separate route clinics, field notes, changes, and progress without building
  a custom social product.
- The likely audience is consumer/prosumer, not only developers.

Known tradeoff: Telegram discussion still becomes noisy and is not the system of record.
Durable conclusions must move into the dataset, documentation, or a later public
knowledge base. Never let an important legal claim live only in chat.

**Do not open it publicly while empty.** First recruit members manually and seed the
conversations that demonstrate the intended culture.

## Minimum Telegram architecture

Keep the pilot intentionally small:

| Surface / topic | Purpose | Desired behavior |
|---|---|---|
| Announcement channel | Reviewed changes and product updates | Read; follow a change into a route or source |
| `Start here` topic | Promise, boundaries, privacy, and “not legal advice” | Read before posting |
| `Introductions & goals` topic | Redacted current position, desired outcome, and time horizon | Introduce yourself with a real goal |
| `Route clinic` topic | Pressure-test a specific path | Ask focused questions; separate evidence from experience |
| `Field notes` topic | First-hand timelines, appointments, costs, and friction | Share what actually happened and when |
| `Sources & corrections` topic | Primary sources and suspected dataset issues | Link evidence; state jurisdiction and date |
| `Wins & progress` topic | Milestones and completed steps | Close the loop and thank helpers |
| `Product lab` topic | Early features and roadmap decisions | Test and critique with context |
| Private bot | Profile-specific, reviewed route alerts | Return to the affected route or discuss the change |

Add more topics only when repeated traffic makes the need obvious.

## Founding cohort

Recruit 20–30 people one at a time:

- 5–8 actively pursuing a route in the next 12 months.
- 5–8 people with first-hand experience of a completed route.
- 3–5 researchers, lawyers, relocation professionals, or unusually rigorous hobbyists.
- 3–5 globally mobile families or couples who expose household-planning needs.
- A few curious option-builders who will test discovery and onboarding.

The invitation should explain why that person was selected and ask for one concrete
contribution in their first week. Do not use a generic mass invite.

## Seed content before the first invite

Prepare at least ten posts:

1. Founder introduction and the reason Flag Paths exists.
2. Community charter: evidence, experience, uncertainty, and respect.
3. “Share what you have vs what you want” introduction template.
4. One complete route clinic using a realistic example.
5. One field note with dates, costs, and what surprised the author.
6. One open data question that members can help verify.
7. One correction showing how a source becomes a tested product change.
8. One household-planning discussion involving partner citizenship.
9. One product-lab prompt about the dedicated strategy explorer.
10. One progress/wins thread that models small milestones, not passport collecting.

## Ninety-day pilot

### Weeks 1–2: Foundation

- Write the community charter and simple privacy rules.
- Create the Telegram channel, discussion group, and seven pilot topics; seed ten posts.
- Build a list of 30 prospective founding members.
- Personally invite the first 10 and speak with each of them.
- Record the starting hypothesis for why each person would return weekly.

**Gate:** At least 8 members join and 5 make a substantive post or reply. If not,
interview the invitees before expanding.

### Weeks 3–6: Closed founding cohort

- Grow deliberately to 20–30 members.
- Run one weekly route clinic at a time convenient for two major time zones.
- Publish one weekly “what the community clarified” recap.
- Respond to every unanswered route question within 24 hours, even if the answer is
  “we need a better source.”
- Credit members whenever their work changes the dataset or product.

**Gate:** Continue only if members other than the founder generate at least half of
substantive contributions and at least 70% of questions receive a useful reply within
48 hours.

### Weeks 7–12: Prove the flywheel

- Invite each active founder to bring one relevant person.
- Add a lightweight public community page only after the room feels alive.
- Publish credited, source-safe community outcomes as atlas updates or research notes.
- Start a short weekly digest of route clinics, member wins, and verified changes.
- Interview active members, lurkers, and people who left.

**Gate:** Consider a broader launch if weekly active participation is at least 30%,
new members make a substantive contribution within seven days at least 25% of the time,
and non-founder contributions repeatedly improve the product.

These are pilot thresholds, not universal benchmarks; adjust them after observing the
first cohort.

## Recurring rituals

- **Weekly route clinic:** One member’s goal, facts, current hypothesis, and blockers.
- **Friday field note:** A first-hand update with jurisdiction and date.
- **Monthly atlas changelog:** Community contributions that became product changes.
- **Monthly “what changed?” review:** One recently changed rule or disputed claim.
- **Member milestone:** Celebrate completed research, filings, appointments, approvals,
  and corrections—not only final citizenship outcomes.

## Health metrics

Track weekly in a simple sheet:

- Invited, joined, and active members.
- New-member substantive contribution rate within seven days.
- Percentage of questions receiving a useful reply within 48 hours.
- Weekly active members divided by total members.
- Percentage of substantive contributions created by non-founders.
- Verified sources, corrections, or product improvements originating in the community.
- Number of members who return for a second and fourth active week.

Avoid vanity metrics such as raw member count without participation.

## Product boundaries during the pilot

Build only what removes observed friction:

- A public community landing page after the founding room has activity.
- Deep links that let a member share a planner state without exposing unnecessary data.
- A private route watchlist and reviewed-change impact matching.
- A Telegram bot connection once the monitoring service can deliver real alerts.
- A “discuss or verify this route” handoff using a deliberately redacted route brief.
- Contributor attribution and a visible community changelog.
- Accounts and saved cloud profiles only when repeated behavior proves they are needed.

Do not build feeds, direct messages, badges, leaderboards, or a custom forum during the
pilot. Recognition can start as names in the changelog and personal thank-yous.

## Immediate next move

Current product sequence:

1. Ship the progressive mobility profile and local route watchlist.
2. Give dataset rules stable monitoring identities and build reviewed change detection.
3. Connect a private Telegram bot for watched-route delivery.
4. Add a redacted route brief with a “discuss this route” handoff.
5. Recruit the first five people and conduct short onboarding conversations.

The profile remains private by default. Telegram receives only the information required
to deliver a chosen watch; it does not become the owner of the mobility profile.

## Open decisions

- Is “Global option-builders” language members naturally identify with?
- Is the primary business outcome retention, word of mouth, contribution quality, or
  product research during the first 90 days?
- How many founder hours per week are available for invitations, replies, and rituals?
- Which profile facts are safe and useful to share in a community route brief?

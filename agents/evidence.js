/* =====================================================================
   EVIDENCE, NOT A VERDICT
   ---------------------------------------------------------------------
   The simulation no longer tells a team whether their society was good.
   Teams weight the guiding rubric — social welfare, continuity of
   survival, quality of life, economic profitability — and argue their
   case; juries judge it. The simulation's job is to hand both of them
   rich, trustworthy evidence to argue from.

   So this report is organised by what a team would need to SUBSTANTIATE
   a claim, not by marks:

     provenance     who decided this run, how much of it was agents, which
                    model, whether it was calibrated, how to replay it
     trajectory     the country, round by round
     industries     each industry against its FIXED mission KPIs, the same
                    yardstick in every team's world
     society        what people reported, did, formed, and left
     market         firms, prices, entries and exits
     government     what was enacted, amended, rejected, untranslatable,
                    and what was said publicly
     events         what the world did to them
     voices         what people and firms said, by reach
     rubric         the team's own weighting and case, stored UNSCORED
     reference      the legacy score, kept as one more piece of evidence

   None of it combines into a single number, on purpose.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');
const MIS = require('../engine/sector_missions.js');
const INS = require('./institutions.js');
const POP = require('./population.js');

const round1 = v => Math.round(v * 10) / 10;

/* WHAT PEOPLE DID, BEHAVIOUR BY BEHAVIOUR
   Every behaviour the society produced, when it first appeared, how far it
   spread year by year, who did it and what it did. A behaviour the old
   pattern list would not have recognised is marked novel: that is the
   list worth reading first, because nobody wrote it in. */
function behavioursOf(run) {
  const rounds = (run.log && run.log.behaviours) || [];
  if (!rounds.length) return null;
  const by = {};
  rounds.forEach(r => r.list.forEach(b => {
    const m = by[b.label] || (by[b.label] = { label: b.label, novel: !b.anticipated, anticipated_as: b.anticipated || null,
      first_year: r.year, by_year: [], peak_share: 0, who: {}, what_it_did: [], examples: [], lasting: false, sources: {} });
    m.by_year.push({ year: r.year, share: b.share });
    m.peak_share = Math.max(m.peak_share, b.share);
    Object.keys(b.by_status).forEach(k => { m.who[k] = (m.who[k] || 0) + b.by_status[k]; });
    b.channels.forEach(c => { if (m.what_it_did.indexOf(c) < 0) m.what_it_did.push(c); });
    b.examples.forEach(x => { if (m.examples.length < 4 && m.examples.indexOf(x) < 0) m.examples.push(x); });
    Object.keys(b.sources || {}).forEach(k => { m.sources[k] = (m.sources[k] || 0) + b.sources[k]; });
    if (b.lasting) m.lasting = true;
    if (b.anticipated && !m.anticipated_as) { m.anticipated_as = b.anticipated; m.novel = false; }
  }));
  return Object.keys(by).map(k => {
    const m = by[k];
    const total = Object.keys(m.who).reduce((a, s) => a + m.who[s], 0) || 1;
    m.who = Object.keys(m.who).sort((a, b) => m.who[b] - m.who[a]).slice(0, 3)
      .map(s => ({ status: s, pct: Math.round(m.who[s] / total * 100) }));
    m.years_seen = m.by_year.length;
    m.peak_share = round1(m.peak_share);
    /* What this behaviour would look like as an institution, if the team
       decided to make it part of the country. */
    m.institution_draft = INS.draftFrom(m);
    return m;
  }).sort((a, b) => (b.novel - a.novel) || (b.peak_share - a.peak_share));
}

function worstOf(s) { return Math.min.apply(null, E.ESSENTIAL.map(k => s.sectors[k].quality)); }

function build(run, con) {
  /* Under ticks a run has a state for every month; the report reads it once
     a year, so its tables are the same shape whatever the tick. */
  const traj = run.yearly || run.trajectory;
  const first = traj[0], last = traj[traj.length - 1];
  const decided = run.counts;
  const total = pop => decided[pop].model + decided[pop].replay + decided[pop].fallback;
  const share = pop => total(pop) ? round1((decided[pop].model + decided[pop].replay) / total(pop) * 100) : 0;
  const agentShare = (total('citizen') + total('firm'))
    ? round1((decided.citizen.model + decided.citizen.replay + decided.firm.model + decided.firm.replay) /
             (total('citizen') + total('firm')) * 100) : 0;

  const provenance = {
    team: run.team, seed: run.seed, rounds: run.rounds, substeps: run.substeps,
    model: run.model, mode: run.mode, tokens: run.tokens || null,
    waits: run.waits || null,
    time: run.time || null,
    storage: run.storage || null,
    decided_by_agents_pct: { citizens: share('citizen'), firms: share('firm'), overall: agentShare },
    decisions: decided,
    /* Degraded: a run where the fallback made a meaningful share of the
       decisions. It is still a valid run of the physics; it is not a
       society. */
    degraded: agentShare < 80,
    degraded_reason: !run.model ? 'no model: every decision was the labelled baseline'
      : agentShare < 80 ? (100 - agentShare) + '% of decisions fell back to the baseline' : null,
    calibration: run.calibration || { passed: false, note: 'not calibrated' },
    assessed: run.assessed, uncalibrated_override: run.uncalibrated_override,
    replay: 'the trace replays the kernel exactly; the decision log replays every agent',
    faults: run.faults.length
  };

  const trajectory = traj.map(s => ({
    year: s.meta.year, round: s.meta.round,
    population: s.population.total, working_age: s.population.by_age.age_20_64, elderly: s.population.by_age.age_65_plus,
    employed: s.population.employed_total, employment_rate: s.indicators.employment_rate,
    payment_sgd: s.indicators.ubi_monthly_sgd, real_payment_index: s.indicators.real_ubi_index,
    effective_payment_index: s.indicators.effective_ubi_index, consumption_index: s.indicators.consumption_index,
    gini: s.indicators.gini, cohesion: s.indicators.cohesion, legitimacy: s.indicators.legitimacy,
    civic_unrest: s.indicators.civic_unrest, reserves_bn: s.fiscal.reserves_bn, gdp_bn: s.fiscal.gdp_bn,
    worst_essential: worstOf(s), energy_tightness: s._computeTightness == null ? null : s._computeTightness,
    policy_spend_bn: s._policySpend_bn == null ? 0 : s._policySpend_bn,
    shocks: s.shocks
  }));

  const industries = E.ORDER.map(k => {
    const m = MIS.MISSIONS[k];
    return {
      sector: k, name: E.SECTORS[k].name, essential: !!E.SECTORS[k].essential,
      mission: m ? m.mission : null,
      kpi_weights: m ? m.kpi : null,
      /* Quality IS performance against the fixed mission scorecard: the
         engine scores every sector through `scoreAgainstMission`. */
      kpi_performance: traj.map(s => s.sectors[k].quality),
      start: summariseSector(first.sectors[k]), end: summariseSector(last.sectors[k]),
      lowest: Math.min.apply(null, traj.map(s => s.sectors[k].quality))
    };
  });

  const society = {
    rounds: run.log.society.map(x => ({
      year: x.year, month: x.month || null, trust: x.polls.trust, belonging: x.polls.belonging, satisfaction: x.satisfaction,
      spending_share: x.propensity, willingness_to_work: x.labour_supply, births_vs_normal: x.births_mult,
      left_the_country: x.departed, organisations: x.organisations,
      actions: x.action_shares, strikes: x.strike_share_by_sector, protest_pct: x.protest_share,
      mutual_aid_pct: x.mutual_aid_share, organised_calls: x.calls,
      things_people_tried_that_the_world_cannot_do_yet: x.unrouted, unrouted_count: x.unrouted_count,
      infeasible_count: x.infeasible_count, informal_pct: x.informal_share == null ? null : Math.round(x.informal_share * 1000) / 10,
      novel_behaviours: x.novel_count == null ? null : x.novel_count
    })),
    organisations: run.log.organisations.sort((a, b) => b.represents - a.represents),
    personas: run.population,
    behaviours: behavioursOf(run),
    /* The team's own ways of sharing out, and who they reached. */
    distribution: (run.schemes || []).length ? {
      schemes: run.schemes,
      by_decision: (run.log.distribution || []).map(d => ({ year: d.year, month: d.month || null, paid_bn_year: d.paid_bn_year,
                                                           from_the_payment_bn: d.from_the_payment_bn, schemes: d.schemes })),
      note: 'Schemes only act where people act. Who earned is worked out from what residents did, as the interpreter read it.'
    } : null,
    /* The same people, followed for the whole run, in their own words. */
    panel: run.log.panel && run.log.panel.members.length ? {
      note: 'A fixed sample followed all run. Their reasoning is kept in full; everyone else contributes numbers.',
      members: run.log.panel.members.map(m => Object.assign({}, m, {
        years: run.log.panel.entries.filter(e => e.id === m.id).map(e => {
          const c = Object.assign({}, e); delete c.id; return c; })
      }))
    } : null,
    /* What the team had already institutionalised before this run started. */
    institutions: (run.institutions || []).map(i => Object.assign({}, i, {
      adopted_as: INS.ADOPTIONS[i.adoption].label,
      people_were_told: true,
      spread_of_its_behaviour: i.behaviour && run.log.behaviours
        ? run.log.behaviours.map(r => ({ year: r.year, share: (r.list.find(b => b.label === i.behaviour) || {}).share || 0 }))
        : null
    })),
    actions: run.actions ? {
      mode: run.actions.mode,
      interpreter: run.actions.stats || null,
      interpretations: run.actions.interpretations || null
    } : { mode: 'registry' }
  };

  const market = {
    events: [].concat.apply([], run.log.industry.map(x => x.events.map(e => Object.assign({ year: x.year }, e)))),
    final: run.log.industry.length ? run.log.industry[run.log.industry.length - 1].sectors : null
  };

  const government = {
    enacted: run.government.history.length ? run.government.history[run.government.history.length - 1].policies : [],
    history: run.government.history.map(h => ({ year: h.year, change: h.change, reasoning: h.reasoning || null,
                                                repealed: h.repealed || [], protected: h.protected || [],
                                                count: h.policies.length })),
    rejected: run.government.rejected,
    untranslatable: run.government.untranslatable,
    reviews: run.government.reviews,
    /* What the team changed while the run was under way, and when. */
    amendments: run.amendments || [],
    /* Who set the levers, round by round, and why. */
    kind: run.government.kind || 'none',
    declared: run.government.declared || null,
    rounds: run.government.rounds || [],
    ungoverned_rounds: (run.government.rounds || []).filter(r => r.fallback).map(r => r.year),
    /* Whether the government kept its word, from the deterministic audit. */
    audit: run.audit ? {
      constitutional_drift: run.audit.constitutional_drift,
      terms: run.audit.terms,
      checkable_rules: {
        checked: run.audit.detail.doctrine.rules_checked,
        held: run.audit.detail.doctrine.rules_held,
        compliance: run.audit.detail.doctrine.compliance,
        results: run.audit.detail.doctrine.results
      },
      clauses_never_cited: run.audit.detail.clauses_never_cited,
      unminuted_rounds: run.audit.detail.unminuted_rounds,
      rounds_nobody_governed: run.audit.detail.fallback_rounds
    } : null,
    announcements: run.log.feed.filter(f => f.kind === 'government').map(f => ({ year: f.year, text: f.text }))
  };

  const voices = run.log.feed.filter(f => f.kind !== 'government')
    .sort((a, b) => b.reach - a.reach).slice(0, 40);

  const rubric = run.government.rubric || (con ? require('./policy.js').parseRubric(con.source || '') : null);

  const headline = {
    years: first.meta.year + '–' + last.meta.year,
    population: [first.population.total, last.population.total],
    employment_rate: [first.indicators.employment_rate, last.indicators.employment_rate],
    effective_payment_index: [first.indicators.effective_ubi_index, last.indicators.effective_ubi_index],
    worst_essential_lowest: Math.min.apply(null, trajectory.map(t => t.worst_essential)),
    reserves_bn: [first.fiscal.reserves_bn, last.fiscal.reserves_bn],
    trust_last: society.rounds.length ? society.rounds[society.rounds.length - 1].trust : null,
    left_the_country: society.rounds.reduce((a, x) => a + (x.left_the_country || 0), 0),
    organisations: society.organisations.length,
    decided_by_agents_pct: provenance.decided_by_agents_pct.overall,
    degraded: provenance.degraded
  };

  return {
    headline, provenance, trajectory, industries, society, market, government,
    events: run.log.events.map(e => ({ year: e.year, label: e.label, severity: e.severity, source: e.source,
                                       rounds: [e.start, e.end], perceived: e.perceived })),
    voices,
    rubric: rubric ? Object.assign({}, rubric, {
      note: 'Recorded as the team wrote it. The simulation does not score the rubric: teams argue it, juries judge it.'
    }) : null,
    reference: {
      legacy_score: E.score(traj, con, run.audit ? { constitutional_drift: run.audit.constitutional_drift } : undefined),
      note: 'The original fixed score, kept as one more piece of evidence. It is not the verdict.'
    },
    /* Which official tables the residents were drawn from, so a reader
       can check any share against its source. */
    population_sources: {
      note: 'How many people there are in each age band and industry is set by the scenario. Who they are (age, ethnicity, home, ' +
            'region, household, children, health, income position, why they are not working) is drawn from these published tables.',
      built: POP.SOURCES.built,
      tables: POP.SOURCES.sources.map(s => ({ id: s.id, title: s.title, agency: s.agency, period: s.period, used_for: s.used_for, url: s.url })),
      typed_in: POP.SOURCES.typed_in,
      modelled: ['months of savings', 'ability to leave the country', 'temperament (five traits, each equally likely from 1 to 5)', 'names']
    },
    approximations: [
      'Residents are present-day Singaporeans, as the published statistics describe them, placed in the 2050 economy.',
      'Income position joins two tables published separately (by type of home, and by industry) as if independent once income is known.',
      'Thirteen scenario industries are matched to nine published ones, so healthcare and care share one profile, as do education, public administration and public safety.',
      'Sub-steps are social deliberation; the economy clears once per two-year round on time-averaged decisions.',
      'Firm market shares respond to price and investment by a modelled rule; firm-level margins are estimated from the sector.',
      'Conversion constants (what a strike, mutual aid or a policy yields in kernel units) are placeholders documented in the code.'
    ]
  };
}

function summariseSector(s) {
  return { kpi_performance: s.quality, capacity: s.capacity, margin: s.margin, automation: s.automation, headcount: s.headcount };
}

/** Flat numbers for comparing runs and seeds. */
function summary(run) {
  const t = run.evidence.trajectory;
  const last = t[t.length - 1];
  const soc = run.evidence.society.rounds;
  const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    final_population: last.population,
    final_employment_rate: last.employment_rate,
    final_effective_payment_index: last.effective_payment_index,
    lowest_effective_payment_index: Math.min.apply(null, t.map(x => x.effective_payment_index)),
    final_worst_essential: last.worst_essential,
    lowest_worst_essential: Math.min.apply(null, t.map(x => x.worst_essential)),
    final_reserves_bn: last.reserves_bn,
    final_gini: last.gini,
    mean_legitimacy: round1(mean(t.map(x => x.legitimacy))),
    final_trust: soc.length ? soc[soc.length - 1].trust : null,
    left_the_country: soc.reduce((a, x) => a + (x.left_the_country || 0), 0),
    organisations: run.evidence.society.organisations.length,
    decided_by_agents_pct: run.evidence.provenance.decided_by_agents_pct.overall
  };
}

module.exports = { build, summary };

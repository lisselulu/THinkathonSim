/* =====================================================================
   THE STARTER DICTIONARY
   ---------------------------------------------------------------------
   What ordinary actions mean, the same in every team's world.

   A team's own discoveries are private: whatever its people invent is
   interpreted for that team alone. But if "go on strike" were interpreted
   separately for every team, two countries could end up with slightly
   different readings of the most ordinary act there is, and their results
   would differ for a reason that has nothing to do with how they govern.

   So the everyday vocabulary is fixed here, once, before the event, and
   every team starts from it. It is authored and reviewable rather than
   generated, because it is a rule of the world.

   An entry is matched on the ACTION alone, whatever its target, and an
   effect marked \`from_target\` takes its industry from the target the
   person named ("volunteer | at the hospital" acts on healthcare), falling
   back to the industry written here.

       node agents/build-dictionary.js            write the dictionary
       node agents/build-dictionary.js --print    show it without writing
   ===================================================================== */

'use strict';

const INT = require('./interpreter.js');

const T = (sector, amount) => ({ channel: 'time_to_sector', sector: sector, amount: amount == null ? 1 : amount, from_target: true });
const E_ = (channel, amount, extra) => Object.assign({ channel: channel, amount: amount }, extra || {});

/* label, hours a week, effects, [requires], then every phrasing that means it */
const ENTRIES = [
  ['helping neighbours', 6, [T('care_services'), E_('cohesion', 0.5)], null,
    ['help neighbours', 'help my neighbours', 'help neighbors', 'help my neighbors', 'help out neighbours', 'look after neighbours',
     'check on elderly neighbours', 'help others', 'help people around me', 'support my neighbours']],
  ['volunteering', 6, [T('care_services'), E_('cohesion', 0.4)], null,
    ['volunteer', 'volunteering', 'do volunteer work', 'volunteer my time', 'volunteer locally', 'volunteer in the community']],
  ['caring for family', 10, [T('care_services', 0.8)], null,
    ['care for family', 'look after family', 'care for my parents', 'look after my parents', 'care for elderly parents',
     'look after my children', 'spend time with family', 'care for my family']],
  ['donating', 0, [E_('spending', 0.2), E_('cohesion', 0.3)], null,
    ['donate', 'donate money', 'give to charity', 'donate to charity', 'donate food']],
  ['striking', 0, [E_('labour_withheld', 1), E_('unrest', 0.4)], { job: true },
    ['strike', 'go on strike', 'join the strike', 'join a strike', 'walk out', 'stop work', 'take industrial action']],
  ['working to rule', 0, [E_('labour_withheld', 0.4)], { job: true },
    ['work to rule', 'go slow', 'do the minimum at work']],
  ['protesting', 4, [E_('unrest', 1), E_('legitimacy', -0.6)], null,
    ['protest', 'join a protest', 'join the protest', 'march', 'attend a rally', 'demonstrate', 'join a demonstration']],
  ['petitioning', 1, [E_('legitimacy', -0.2), E_('unrest', 0.1)], null,
    ['petition', 'sign a petition', 'start a petition', 'write to my mp', 'complain to the government', 'give feedback to the government',
     'attend a town hall', 'speak up']],
  ['rioting', 4, [E_('unrest', 1), E_('harm', 1, { sector: 'retail_commerce' }), E_('cohesion', -1)], null,
    ['riot', 'loot', 'smash things up']],
  ['supporting the government', 1, [E_('legitimacy', 0.3)], null,
    ['support the government', 'trust the government', 'back the government', 'follow the rules', 'cooperate with the government']],
  ['joining a group', 2, [E_('organise', 1)], null,
    ['join', 'join a group', 'join a union', 'join the union', 'join a residents group', 'join a community group', 'join a club',
     'form a group', 'start a group', 'organise a group', 'organize a group', 'form a union', 'start a union']],
  ['attending community meetings', 2, [E_('cohesion', 0.3)], null,
    ['attend community meetings', 'attend a community meeting', 'go to community events', 'attend community events', 'attend',
     'meet neighbours', 'meet up with friends', 'spend time with friends', 'chat', 'chat with', 'reconnect with old friends', 'network']],
  ['saving more', 0, [E_('spending', -0.5)], null,
    ['save', 'save more', 'save money', 'cut back', 'cut back spending', 'spend less', 'tighten my budget', 'cut expenses', 'reduce spending']],
  ['spending more', 0, [E_('spending', 0.5)], null,
    ['spend more', 'treat myself', 'go shopping']],
  ['boycotting', 0, [E_('demand_shift', -0.8, { sector: 'retail_commerce', from_target: true })], null,
    ['boycott', 'stop buying', 'refuse to buy', 'stop buying from']],
  ['looking for work', 5, [E_('labour_supply', 0.5)], { working_age: true },
    ['look for work', 'look for a job', 'look for a new job', 'look for a better job', 'apply for jobs', 'job hunt', 'search for work',
     'find a job', 'find work', 'seek work', 'attend job fairs', 'look for part time work']],
  ['retraining', 8, [E_('labour_supply', -0.3)], null,
    ['retrain', 'reskill', 'upskill', 'take a course', 'take courses', 'learn new skills', 'study', 'attend training', 'attend retraining courses']],
  ['working informally', 10, [E_('informal_production', 1, { sector: 'retail_commerce', from_target: true }), E_('labour_supply', -0.5)], null,
    ['work informally', 'take cash jobs', 'do odd jobs', 'do gig work', 'take a side job', 'find a side hustle']],
  ['starting a business', 20, [E_('found_business', 1, { sector: 'retail_commerce', from_target: true })], { min_savings_months: 2 },
    ['start a business', 'start a small business', 'open a shop', 'open a stall', 'start my own business', 'launch a business']],
  ['working more', 6, [E_('labour_supply', 0.5)], { job: true },
    ['work more', 'work overtime', 'take extra shifts', 'pick up more shifts', 'work longer hours']],
  ['working less', 0, [E_('labour_supply', -0.5)], { job: true },
    ['work less', 'cut my hours', 'reduce my hours', 'take time off']],
  ['carrying on', 0, [], null,
    ['nothing', 'do nothing', 'carry on', 'carry on as usual', 'keep going', 'get on with life', 'wait and see', 'stay put',
     'continue as usual', 'keep working', 'keep my job', 'keep my head down']]
];

function build() {
  const items = {};
  ENTRIES.forEach(([label, hours, effects, requires, phrases]) => {
    phrases.forEach(p => {
      const key = INT.keyOf({ do: p });
      const it = INT.clean({ label: label, hours_per_week: hours, effects: effects, requires: requires || {} }, key, 'starter');
      /* \`clean\` drops fields it does not know; put back which effects read
         their industry from the target. */
      it.effects.forEach((e, i) => { if (effects[i] && effects[i].from_target) e.from_target = true; });
      it.any_target = true;
      items[key] = it;
    });
  });
  return items;
}

if (require.main === module) {
  const items = build();
  if (process.argv.indexOf('--print') >= 0) {
    Object.keys(items).sort().forEach(k => console.log(k.padEnd(34) + ' → ' + items[k].label));
    console.log('\n' + Object.keys(items).length + ' phrasings of ' + ENTRIES.length + ' ordinary actions');
  } else {
    const n = INT.writeStarter(items);
    console.log('wrote ' + n + ' phrasings of ' + ENTRIES.length + ' ordinary actions to ' + INT.STARTER_FILE());
  }
}

module.exports = { build, ENTRIES };

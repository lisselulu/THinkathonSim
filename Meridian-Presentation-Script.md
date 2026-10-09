# Meridian: Spoken Presentation Script

*Written to be read aloud to a technical audience hearing about Meridian for the first time. It runs about fifteen to eighteen minutes. Section headings are for you, not for the audience. Updated to match the code and README as of 5 October 2026.*

---

## Opening

Good morning, everyone. I want to start with a question. Imagine it is Singapore in 2050, and artificial intelligence can do most of the routine work, both thinking work and physical work. Productivity is climbing, and employment is falling. Here is the uncomfortable part: those are the same event. So what does a government do?

That is the question behind Meridian. Meridian is a simulator of that future. In the next few minutes I will explain what it is, how it works, and what we are trying to learn from it.

## The scenario

Let me set the scene. Your team governs a city-state of 5.9 million people. The population is ageing quickly. Over the course of the original design, the share of people over 65 rises from 28 percent to 35 percent. Almost all of the food is imported, and the country has no natural resources except the ones it builds.

The economy has thirteen sectors, such as healthcare, care services, education, transport, energy, compute, manufacturing and finance. They are shaped like Singapore's real economy. For example, there is no mining, because Singapore has none. We keep energy and compute as separate sectors on purpose, because a power grid takes a decade to build, while a data network can automate almost overnight. If you merge them, the tension between AI and energy disappears. We also include public administration as a sector, so a government can watch its own ability to govern decline.

One more point matters here. We do not judge a team by how much wealth its AI economy produces. We look at how much of that wealth reaches citizens, and whether it keeps reaching them.

## The core idea

Now I want to show you the idea that drives everything, which is an economic loop.

Automation removes wages from the cost of producing things. Because wages fall, profit rises, and the government taxes that profit. The tax pays for services and for a universal basic income, which I will call UBI. That UBI becomes household income, replacing the wages that were lost. Households spend that income, and their spending is the demand that firms sell into. That demand is the very profit the government was taxing in the first place.

So the loop closes on itself. If you automate too hard, you remove the customers who generate the profit that funds the payments that replaced their wages. The UBI rises for several years, and then it falls off a cliff.

What I find striking is that this cliff is not a rule anyone wrote. Nothing in the engine says "punish automation". The engine only does bookkeeping, and the collapse comes out of a single line of code, which says that output equals the smaller of capacity and demand. Output is sold, not merely made. Every decision to automate eventually comes back to that line as lower demand.

There is also a trap hidden in the tax base. It has four legs: corporate profit, a levy on compute, tax on wages, and GST on spending. Automation boosts the first and collapses the other two. So corporate tax receipts can rise while total revenue falls.

## How it is built

Let me turn to how the simulator is built, because the design is what makes it useful.

At the center is an engine. You can think of it as one function that answers a single question: given the state of the country, the policy choices, any shocks, and anything coming from outside, what does the country look like one step later? In shorthand, it is a function called `step`. It takes the state, meaning the whole country at the start of the step. It takes the levers, meaning the government's choices. It takes the shocks, meaning events like a pandemic or an energy price spike. It takes a bundle of outside inputs, which I will come back to. And it takes one more setting, the length of the step. It returns the next state.

That function is deterministic. The same inputs always give the same output. That is what lets us replay any run and compare teams fairly. The engine is also implemented twice, once in JavaScript and once in Python, and a test checks that every field agrees between them, including when the engine runs in monthly steps. We do that so nobody can say the physics were tuned to make a demo look good.

Around that engine there are three populations. The first is the citizens, who are twelve cohorts ranging from a retired cleaner to an owner of automated capital. The second is the industries, which are the thirteen sectors, each acting as an agent with its own goals. The third is the government, which is what each team builds.

The rule that ties it together is this: semantic inside, deterministic at the boundary. A team's government can be anything. It can be a set of rules, a piece of code, or a language model working from a written briefing. But what comes out of it is always a small set of validated numbers that go into the same frozen engine every team uses.

## Time: a month at a time

I should explain how time works, because it changed recently. The original design moved in rounds of two years. The simulator now runs by the month. One tick is one month, a year is twelve ticks, and a run lasts as many years as the team asks for, from one up to 240.

Different things update at different speeds. The government decides every month. Residents and firms decide every third month, and what they chose holds until they choose again. Fast things like prices and output are recomputed every tick. Slower things, like capital and automation adoption, refresh every three months, and population refreshes once a year.

We checked that the change is sound. A single two-year step produces exactly the same result as the original round. Twenty-four monthly steps land within three percent of it. And the JavaScript and Python engines still agree across hundreds of thousands of fields.

Runs can also go at a "live" pace. A tick takes two and a half minutes, so a simulated year takes half an hour, and the whole room watches the country change in real time.

## The levers

So what does a government control? It has nine levers.

It sets how much AI each sector is allowed to adopt, from zero up to 98 percent. It sets the corporate tax rate and a levy on compute. It decides how to split the budget between UBI, infrastructure and reserves. It chooses a UBI design, such as flat, targeted or age-based. It decides how much to spend on reskilling, how much of the automated capital the public should own, whether the working week is five, four or three days, and whether to guarantee jobs in care.

Every one of these is a trade-off. Taxing more raises revenue now but starves the reinvestment that keeps the economy productive later. Shortening the working week spreads out the remaining work but cuts output.

One lever behaves differently from what you might expect. The automation lever is a ceiling, not a target. A government can forbid, tax and subsidise automation, but it cannot force a firm to invest. I will show why that matters in a moment.

I should be honest about the ranges. The code enforces limits such as a 45 percent maximum corporate tax and a 50 percent maximum public ownership, and the 98 percent automation cap matches a clamp inside the engine. But I could not find written reasoning for why those particular numbers were chosen. They look like extreme but still playable settings, and I would describe them as design judgements, not sourced figures.

Two more details are worth knowing. Automation is not uniform. Care services tolerate only about 30 percent automation before quality suffers, while finance tolerates about 95 percent. And there is a one-way door: once a sector passes 80 percent automation, re-employing humans there is sharply slowed.

## What changed most: agents decide

Now I want to tell you about the largest change, because it alters what the simulator is.

In the original design, the engine modelled everything, including how people and firms behave. Now, every choice a person or organisation makes is made by a language model agent. The engine is reduced to a kernel that does only physics and accounting: clearing markets, forming prices, balancing the budget, wearing out capital, and ageing the population.

Each step works in three parts. First, residents look at their own lives and decide what to do, in their own words. Second, a deterministic router works out what those words mean, checks they are possible, and adds them up by who actually took part. So a strike removes the labour of the people actually striking, no more and no less. Third, the kernel runs the economy and posts the accounts.

This matters because it closes a loop that used to be open. Before, a population that went on strike and a population that quietly seethed produced exactly the same country. Now, what people choose in one step shapes the next.

That is also where the fourth input to the engine comes in. It carries everything arriving from outside the engine, such as trade results, and now the decisions the agents made. The engine itself stays pure, and the agents' behaviour is recorded.

## Open-ended behaviour

A few features make this credible. First, residents are not given a menu. They describe what they do in free text. A separate interpreter then decides what that action actually does in the world, using a fixed vocabulary of effects the kernel can compute: time given to a sector, work off the books, labour withheld, spending, harm, trust in government, and so on. So behaviour nobody anticipated still reaches the country.

The interpreter is blind. It sees only the words of the action, never the team, the policies or the score. And every team starts from the same starter dictionary of everyday actions, such as work, strike, volunteer and protest, so ordinary words mean the same thing in every world. Only what a team's own people invent beyond that is private to that team. Each action also has a cost in hours, money and savings, charged against a person's real free time, so nobody creates value from nothing. Organisers can read and correct any interpretation, and corrections always win.

Second, the agents are blindfolded in code, not just by instruction. Citizens see the queue at the clinic but never the tax rate. Firms see the taxes they pay and the prices they face, but not the treasury or the score.

Third, each industry has a mission and a scorecard written by us, not chosen by the agents. Care services lead on humanity, energy on reliability, and finance on whether capital actually reaches the economy, not on margin. An industry that sets its own targets could declare success while the country starves.

## What a team can do with what the society invents

Teams do not only watch the society. They can act on what it produces. If residents start something new, like a repair café or a tool library, the report flags it as novel. The team can then adopt it in one of four ways. They can fund it, license and tax it, make it easier to do, or simply endorse it. Residents are told about adopted institutions, so adoption changes what people decide, not just the arithmetic. A team cannot change what a behaviour means, which keeps comparison between teams fair.

Teams can also design their own way of sharing out wealth. A universal payment to everyone is only where the simulation starts. A team can add a distribution scheme that pays people for what they do, in a credit that exchanges for money. The team chooses what earns the credit, such as giving time to an industry, building ties between people, or organising a group. It chooses what a credit is worth, sets a monthly cap, and decides who pays. The cost can come out of the universal payment itself, which redistributes at no extra cost, or from new money, which is an obligation on the budget. Residents decide for themselves whether to take part.

## Governing live

A real government does not get one chance at its laws, and neither does a team. During a run, a team can pause, change anything on the setup page, save, and then apply the changes and resume. The country carries on from the month it was in, under the new settings. Nothing that already happened is altered, and every change is recorded with its date. The report has a section called "Changed while it was running", so a recovery can be read for what it is: the country before, the decision, and the country after.

## The constitution

Next, let me explain the constitution, because it is where values meet code.

Each team writes a constitution in two halves. One half is prose commitments, such as "no essential service is allowed to fail", which judges read. The other half is rules a machine can check, such as "the worst essential service stays at or above 50". Most teams discover that writing the rule changes the commitment. You find that "no service fails" means nothing until you say at what number, from which year, and whether a shock excuses you.

We also found and fixed a bug here. The scorer was ignoring written constitutions, so every team using prose got full marks for fidelity automatically. After the fix, two societies with identical economies and identical policies, differing only in the written promise, scored 61 and 57.

Teams also choose who governs. They can write rules, such as "when this condition holds, shift five points from UBI to infrastructure", or give a language model a written briefing. That model reads what society did, including trust, who left, and the most-heard voices, before it decides. Either way, the report shows who governed each year, why, and whether the constitution's rules held.

## Trust and fairness

You might reasonably ask how we can trust a government and a society built from language models, since they are not perfectly repeatable. There are several answers.

First, there is no verdict. The simulation does not hand out one grade. It produces evidence: the trajectory, industry results, what people reported and did, the market, the government's record, and the voices of residents. Teams weigh a rubric of social welfare, survival, quality of life and economic profitability, and argue their case.

Second, every team faces identical seeds and events, and results are reported across five seeds, because variance is a result. A government that scores 82 plus or minus 3 beats one scoring 84 plus or minus 19.

Third, a model must pass a five-part behavioural calibration before an assessed run.

Fourth, a run never swaps a decision for a rule. If a reply is invalid, the system asks again. If the model server goes away, it waits however long that takes. We do this because a fallback produces a different society, not a slower one. The run simply takes longer, and the report says by how much: replies asked again, seconds waited, and outages.

Fifth, runs are replayable. By default, a run follows a panel of twenty residents and keeps every decision they make in their own words, plus every firm, government and interpreter decision. A team can switch on "keep every decision" for an exactly replayable run. The report states which kind it is.

Finally, organisers hold the controls. They can fire events live, like a typhoon, an energy crisis or a trade embargo, invent their own, target one team or all, turn on seeded unannounced weather, and pause the whole room.

## What we have learned

So what has the simulator told us so far?

First, taxing automation works, but only if firms can decline to automate. With a heavy tax and a 90 percent automation ceiling, firms that were forced to obey drove employment down to 6 percent and scored zero. When firms could decline, employment held at 33 percent and the score was 63. That is why the lever is a ceiling.

Second, a society we called resilient turned out not to be. Over twelve rounds it looks fine, but run open-ended it decays steadily and collapses after about 34 years.

Third, scarcity matters. If a team automates everything except energy, demand on the grid reaches nearly three times capacity, the price hits its ceiling, and purchasing power falls to one. If it automates only energy, purchasing power rises to 66.

Fourth, the richest society loses. In the original twelve-round engine, one society paid 60 percent more cash than another. Once you counted the services that cash had to buy, citizens had the same standard of living, and the richer one scored 73 against 82.

Fifth, failure arrives long after its cause. One scenario scored a respectable 76 in round seven, then collapsed to 15 by round twelve. The decisions that caused it were made by round four.

## Honest limits

I should be clear about what the simulator does not do well. Small local language models tend to be docile and uniform, so most residents choose the same things, and we recommend calibrating and using a larger model before drawing conclusions. Many of the coefficients are placeholders, and they are labelled as such. The citations in our evidence document were written from memory and still need checking. Reskilling barely changes outcomes yet, even though the brief promises a payoff. And the model server can struggle under load, which is why runs are built to wait for it.

## Closing

Let me bring this together. Meridian is a model of a country where machines do the work, built so that students can govern it, break it, and understand why it breaks. The goals are to find where the cliff is, to measure what actually reaches people, to turn values into rules a machine can check, and to test whether clearer thinking produces better government.

If you remember one sentence, make it this one: the society with the highest UBI will not be the society that wins. The simulator exists so that teams work out why, with evidence, before they write their constitution.

Thank you. I am happy to take questions.

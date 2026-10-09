# The Tampines Compact

We inherit a city that no longer needs most of us to work, and a payment
system built for one that did. We are not writing this to be admired in
2074. We are writing it so that when the numbers get frightening — and they
will — the people sitting in these chairs can be held to what we meant
before we knew what was coming.

Cash is worth only what it can buy. A generous payment in a city with a
failing hospital is not generosity, it is an accounting trick. Everything
below follows from that.

## Commitments

Each clause is a promise in prose, and beneath it the same promise stated
precisely enough that a machine can check it every round. Where a clause
has no rule, it is because we could not agree on how to test it — which is
itself worth knowing about a promise.

1. C1. No essential service falls below 50 for two consecutive rounds. If one is heading there, infrastructure gets the money before the payment does, and we say so out loud.

   ```rule
   when: round > 2
   assert: worstEssential >= 50
   ```

2. C2. We automate where the work is a task and refuse where the work is a relationship. Care and healthcare do not go past their tolerance, whatever the productivity case looks like.

   ```rule
   assert: levers.automation_target.care_services <= 0.30
   ```

3. C3. The payment is judged on what it buys, never on its headline figure. We will not celebrate a rising dollar amount in a round where purchasing power fell.

   ```rule
   when: round > 1
   assert: effectiveUbi >= 70
   ```

4. C4. We hold at least sixty billion in reserves from round four onward. A society that cannot absorb one bad year is not resilient, it is lucky.

   ```rule
   when: round > 3
   assert: fiscal.reserves_bn >= 60
   ```

5. C5. We tax profit at no less than 0.25 and no more than 0.40. Below that we cannot fund the transfer; above it we starve the reinvestment that keeps the capital stock from decaying, and the tax base goes with it.

   ```rule
   assert: levers.corporate_tax_rate >= 0.25 && levers.corporate_tax_rate <= 0.40
   ```

6. C6. When unrest passes 50 we treat it as a fact about our decisions, not a failure of the public. We name the households withholding cooperation and address what they are withholding it over.

7. C7. We may depart from any clause above. We may not depart from it quietly. Every departure is minuted in the round it happens, with the clause named and the reason given.

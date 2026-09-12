/**
 * Demo corpus for the mock ARAG server (`ARAG_MOCK=1`).
 *
 * These eight short documents are original, fictional-but-plausible notes about additive
 * manufacturing — the same domain as the live `progress` Knowledge Box — so the demo, the
 * integration tests and the golden set all have something grounded to answer from with no
 * credentials. Each paragraph is written to be quotable aloud in two sentences.
 *
 * They deliberately contain nothing about geography, health or the weather: the golden set's
 * out-of-scope questions must retrieve nothing so the pipeline hands off.
 */
export interface SeedDoc {
  title: string;
  text: string;
}

export const SEED_DOCS: SeedDoc[] = [
  {
    title: "Desktop Metal Shop System",
    text: `The Desktop Metal Shop System is a binder jetting metal 3D printer built for machine shops that need production volumes. Desktop Metal printers in this family print stainless steel parts in batches rather than one at a time.

Shop System customers typically run 17-4 PH and 316L stainless steel powders. Printed batches move straight to debinding and then to the PureSinter furnace for sintering.`,
  },
  {
    title: "Desktop Metal PureSinter furnace",
    text: `The PureSinter furnace is a Desktop Metal sintering furnace. It debinds and sinters printed metal parts in a single run, and a sealed retort keeps each run clean so parts are not contaminated by residue from earlier batches.

The PureSinter furnace supports materials including stainless steel, tool steel, copper and titanium. Sintering profiles for each material ship with the furnace and can be tuned per batch.`,
  },
  {
    title: "Binder jetting explained",
    text: `Binder jetting is an additive manufacturing process in which a print head deposits a liquid binder onto a bed of metal powder, layer by layer. The resulting green parts are debound and then sintered into dense metal.

Binder jetting metal printers are sold by several manufacturers today. Desktop Metal, HP and Markforged all make binder jetting metal printers, and each pairs them with its own sintering step.`,
  },
  {
    title: "Formlabs SLA and SLS printers",
    text: `Formlabs makes desktop stereolithography and selective laser sintering 3D printers for engineering teams. The Formlabs Form 4 prints resin parts in hours, and the Fuse 1+ prints nylon parts from powder.

Formlabs printers are popular for jigs, fixtures and functional prototypes because the machines fit in a workshop and need no dedicated facility.`,
  },
  {
    title: "3D Systems metal printing",
    text: `3D Systems metal printing systems offer direct metal printing on the DMP Flex and DMP Factory platforms. These systems print titanium and nickel alloy parts for aerospace and energy customers.

A vacuum chamber keeps oxygen below 25 parts per million during direct metal printing, which protects reactive alloys such as titanium.`,
  },
  {
    title: "Binder jetting versus laser powder bed fusion",
    text: `Laser powder bed fusion melts metal powder with a laser and suits small, complex parts with fine features. Binder jetting prints far faster at volume but adds a sintering step, so many factories run both processes side by side.

Choosing between the two usually comes down to batch size, part geometry and how much post-processing capacity the factory already has.`,
  },
  {
    title: "Post-processing printed metal parts",
    text: `Printed metal parts leave the printer as green parts that still contain binder. Debinding removes that binder, and sintering in a furnace densifies the part to close to its theoretical density.

Typical finishing steps after sintering are bead blasting, machining of critical features and, for some alloys, hot isostatic pressing.`,
  },
  {
    title: "Materials for metal additive manufacturing",
    text: `Common metal additive manufacturing materials include 17-4 PH stainless steel, 316L stainless steel, tool steel, copper and titanium. Material choice drives the sintering profile and the mechanical properties of the finished part.

Copper is chosen for heat exchangers and induction coils, while titanium is chosen where strength-to-weight ratio matters most.`,
  },
];

/** Seed payload for `startMockArag({ seed })`. */
export function mockSeed(): Array<{ title: string; text: string }> {
  return SEED_DOCS.map((d) => ({ title: d.title, text: d.text }));
}

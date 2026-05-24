/**
 * Tier 1 seed articles — hand-picked Wikipedia titles almost guaranteed
 * to contain a mind-blowing buried fact when processed by Gemini.
 */
export const SEED_ARTICLES: string[] = [
  // Biology & Nature
  'Turritopsis dohrnii',
  'Mantis shrimp',
  'Tardigrade',
  'Ophiocordyceps unilateralis',
  'Pistol shrimp',
  'Mimic octopus',
  'Lyrebird',
  'Bombardier beetle',
  'Immortal jellyfish',
  'Axolotl',
  'Platypus',
  'Honey badger',
  'Deinococcus radiodurans',
  'Myxozoa',
  'Bdelloid rotifer',

  // Psychology & Brain
  'Cotard delusion',
  'Baader–Meinhof phenomenon',
  'Capgras delusion',
  'Fregoli delusion',
  'Alice in Wonderland syndrome',
  'Prosopagnosia',
  'Blindsight',
  'Rubber hand illusion',
  'Synesthesia',
  'Alien hand syndrome',
  'Troxler effect',
  'Inattentional blindness',
  'Dunning–Kruger effect',

  // History & Events
  'Dancing plague of 1518',
  'Great Molasses Flood',
  'London Beer Flood',
  'Battle of Los Angeles',
  'Project A119',
  'Operation Mincemeat',
  'The Great Emu War',
  'Defenestrations of Prague',
  'The Man in the Iron Mask',
  '1904 Summer Olympics',
  'Phineas Gage',
  'Mary Toft',
  'Stockholm syndrome',
  'Tulip mania',

  // Physics & Space
  'Wow! signal',
  'Fermi paradox',
  'Cosmic inflation',
  'Hawking radiation',
  'Quantum suicide and immortality',
  'Boltzmann brain',
  'Magnetar',
  'Neutron star',
  'Rogue planet',
  'Dyson sphere',
  'Pale Blue Dot',
  'Cosmic microwave background',
  'Vacuum decay',

  // Mathematics & Patterns
  "Zipf's law",
  'Benford\'s law',
  'Six degrees of separation',
  'Monty Hall problem',
  'Birthday problem',
  'Banach–Tarski paradox',
  'Hilbert\'s hotel',
  'Infinite monkey theorem',
  'Gödel\'s incompleteness theorems',

  // Technology & Engineering
  'Cicada 3301',
  'Antikythera mechanism',
  'Baghdad Battery',
  'Turing test',
  'Halting problem',
  'Theoretical computer science',
  'Ship of Theseus',

  // Medicine & Body
  'Locked-in syndrome',
  'Exploding head syndrome',
  'Fatal familial insomnia',
  'Kuru (disease)',
  'Phineas Gage',
  'Supercentenarian',
  'Chimera (genetics)',
  'Tetrachromacy',
  'Savant syndrome',

  // Weird but true
  'Eiffel Tower',
  'Cleopatra',
  'Oxford comma',
  'Great Wall of China',
  'Five-second rule',
  'Toast (honor)',
  'Uncle Sam',
  'The Dress',
  'Uncanny valley',
  'Blue–black or white–gold dress',
]

/**
 * Tier 2 Wikipedia categories — used after seed articles are exhausted.
 *
 * IMPORTANT: every entry here must be a real Wikipedia category name
 * (i.e. "Category:<name>" must exist and return members via the API).
 * Invalid names silently return zero members → fall through to random
 * articles, which almost never produce good hooks.
 *
 * Verified against the Wikipedia category API.
 */
export const BROAD_CATEGORIES: string[] = [
  'Unusual_articles',         // Wikipedia's own curated list — the motherlode
  'Cognitive_biases',         // Psychology — consistently surprising
  'Optical_illusions',        // Visual perception
  'Paradoxes',                // Logic and philosophy
  'Phobias',                  // Human fears
  'Urban_legends',            // Folklore
  'Hoaxes',                   // Famous deceptions
  'Logical_fallacies',        // Reasoning errors
  'Conspiracy_theories',      // Pop-culture theories
  'Pseudoscience',            // Debunked claims
  'Superstitions',            // Cultural beliefs
  'Cryptids',                 // Mysterious creatures
  'Thought_experiments',      // Philosophy and science
  'Animal_cognition',         // Animal intelligence and behaviour
  'Extremophiles',            // Life in extreme conditions
  'Memory_biases',            // Memory and cognition
  'Syndromes',                // Medical curiosities
]

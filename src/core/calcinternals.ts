// The parts of @smogon/calc we depend on that the package does not publish.
//
// `getFinalSpeed` and `isGrounded` are implemented and typed inside the calc but absent from
// its index, and the package ships no `exports` map — so `@smogon/calc/dist/mechanics/util`
// is reachable, and reaching it is the only way to have them. That reach is the fragile part
// of this codebase's relationship with its one runtime dependency: a package's semver
// promises nothing about a file it never published, so an upgrade may move or rename either
// of these with no major bump and no deprecation.
//
// So the reach happens HERE, once, rather than wherever the functions are wanted. Not for
// tidiness — a deep path in two files is two files to find when a calc upgrade breaks, and
// nothing names the set. `fitness/dependency-boundaries.test.ts` pins that this is the only
// module in the tree allowed to import a `dist/` path, which turns "we only do this
// deliberately" from a comment into a predicate.
//
// WHAT MAKES THIS MORE THAN A RE-EXPORT is the contract each binding is declared against.
// The types below are ours, written only in terms the package publishes — `Pokemon`,
// `Field` and `Side` come straight from the index, and `Generation`, which does NOT, is
// DERIVED from the published `Generations.get` rather than reached for down a second
// `dist/` path. So the contract rests entirely on supported surface even though the
// functions it describes do not.
//
// The vendor's function has to satisfy one of those types to be bound to it. TypeScript is
// structurally typed, so the calc needs to know nothing about these declarations to
// conform — unlike a Kotlin class, which would have to declare
// `: FinalSpeed` before it counted as one.
//
// WHAT THAT BUYS, MEASURED by drifting each contract and watching the compiler: a changed
// parameter type, a changed return type, a newly-required parameter and the symbol vanishing
// all fail on the ASSIGNMENT below, naming the function and the shape expected. The one
// change it cannot see is the vendor DROPPING a trailing parameter — a shorter function is
// assignable to a longer type, so the call sites keep passing an argument nobody reads. That
// gap is covered from the other side: speed.test.ts and hazards.test.ts pin known composite
// values, which is what catches a function that still fits but no longer does the same
// thing. Neither guard replaces the other, and the failure worth fearing — a number that is
// quietly wrong — needs both.
//
// The contract is stated in the calc's own published types on purpose. Restating it in our
// vocabulary (`ResolvedMon`, `FieldFacts`) would mean building calc objects here, which is
// `damage.ts`'s job, and would put the speed law and the hazard law in one file for no
// better reason than a shared dependency. The vocabulary boundary already exists a layer
// up: `speed.finalSpeed` and `hazards.switchInDamage` both take our types and return plain
// numbers. What this module hides is the package's file layout, which is the thing that
// actually moves.

import {Generations, type Field, type Pokemon, type Side} from '@smogon/calc';
import {getFinalSpeed, isGrounded} from '@smogon/calc/dist/mechanics/util';

/** The calc's resolved generation. Absent from the package index — but `Generations.get`
 *  is published and returns one, so the type comes from the public surface either way. */
type Generation = ReturnType<typeof Generations.get>;

/** A Pokémon's Speed with every modifier applied — boosts, paralysis, Tailwind, Choice
 *  Scarf, the weather and terrain abilities. `side` is the holder's OWN side. */
type FinalSpeed = (gen: Generation, pokemon: Pokemon, field: Field, side: Side) => number;

/** Whether a Pokémon is standing on the ground, which decides what entry hazards reach it
 *  — Flying, Levitate, an Air Balloon and Magnet Rise all lift it off. */
type IsGrounded = (pokemon: Pokemon, field: Field) => boolean;

export const finalSpeedOf: FinalSpeed = getFinalSpeed;
export const groundedOn: IsGrounded = isGrounded;

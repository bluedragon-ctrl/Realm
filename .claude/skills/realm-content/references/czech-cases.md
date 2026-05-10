# Czech case cheat sheet

Quick reference for picking the right `name*` field and `{target.X}` placeholder when writing Czech NPC/item content. Pair this with [SKILL.md](../SKILL.md) Step 4.

## Preposition → case lookup

| Preposition       | Case                | Example template (`{target}` is a fox = liška)              |
|-------------------|---------------------|-------------------------------------------------------------|
| `do`              | gen — `{target.gen}`| `zabodne tesáky do {target.gen}` → "do lišky"               |
| `od`              | gen                 | `koupíš chleba od {target.gen}` → "od pekařky"              |
| `u`               | gen                 | `čenichá u nohou {target.gen}` → "u nohou Petra"            |
| `bez`             | gen                 | `bez {target.gen}` → "bez lišky"                            |
| `k` / `ke` / `ku` | dat — `{target.dat}`| `přiběhne k {target.dat}` → "k lišce"                       |
| `proti`           | dat                 | `proti {target.dat}` → "proti lišce"                        |
| `na`              | acc (default)       | `kouká na {target}` → "na lišku"                            |
| `pro`             | acc                 | `pro {target}` → "pro lišku"                                |

**dat ≈ loc shortcut.** In singular, dative and locative are the same form for almost every Czech noun (`po lišce`, `po Petrovi`, `o medvědovi`). We don't have a `nameLoc` field, so for `po + loc` templates use `{target.dat}` — it produces the right surface form. Same trick for `o + loc` (`o lišce` = "about the fox") if you ever need it. Confirmed for the patterns we use; very rare exceptions exist (some neuter -i nouns) but none in current content.

## Verb → case lookup

| Verb (3rd-person)              | Case of object | Use                            |
|--------------------------------|----------------|--------------------------------|
| `dá`, `dává`, `podá`, `podává` | dat            | `podává {item} {target.dat}`   |
| `kouše`, `udeří`, `bodne`, `kousne`, `kopne`, `zasáhne`, `pronásleduje` | acc | `kouše {target}`               |
| `uzdravuje`, `osvěžuje`, `obnovuje` | acc      | `uzdravuje {target}`           |
| `mává na`, `kouká na`          | acc (after na) | `kouká na {target}`            |

Possessive ("X's hand/lips/feet") always uses gen: `do ruky {target.gen}`, `k ústům {target.gen}`, `u nohou {target.gen}`.

## Common declensions

These are the patterns you hit most often in Realm content. When inventing a new NPC name, find the closest paradigm.

**Masculine animate, hard, consonant ending** (Petr, medvěd, kovář, kobold, vlk, horník):

| nom        | acc        | dat            | gen       | voc       |
|------------|------------|----------------|-----------|-----------|
| kovář      | kováře     | kovářovi       | kováře    | kováři    |
| medvěd     | medvěda    | medvědovi      | medvěda   | medvěde   |
| kobold     | kobolda    | koboldovi      | kobolda   | kobolde   |

Note: gen and acc match for animate masc — that's why many bugs in pre-declension content went unnoticed.

**Masculine animate with movable -e-** (pes → psa, Pavel → Pavla):

| nom   | acc   | dat     | gen   | voc   |
|-------|-------|---------|-------|-------|
| pes   | psa   | psovi   | psa   | pse   |
| Pavel | Pavla | Pavlovi | Pavla | Pavle |

**Feminine -a, hard** (liška, Anna, pekařka, krysa, vosa):

| nom     | acc     | dat       | gen     | voc     |
|---------|---------|-----------|---------|---------|
| liška   | lišku   | lišce     | lišky   | liško   |
| pekařka | pekařku | pekařce   | pekařky | pekařko |
| Anna    | Annu    | Anně      | Anny    | Anno    |

The dat ending alternates: `-ka` → `-ce`, `-ra` → `-ře`, `-na` → `-ně`, `-va` → `-vě`, `-ta` → `-tě`, `-da` → `-dě`. When in doubt, fall back to `+ě`.

**Feminine i-stem (consonant ending)** (stráž, kost):

| nom    | acc    | dat     | gen     | voc    |
|--------|--------|---------|---------|--------|
| stráž  | stráž  | stráži  | stráže  | stráži |

Nominative and accusative are identical here.

**Neuter -e/-ě** (mládě, kotě):

| nom    | acc    | dat       | gen        | voc   |
|--------|--------|-----------|------------|-------|
| mládě  | mládě  | mláděti   | mláděte    | mládě |

Nom and acc identical; dat and gen take an inserted `-t-`.

**Nominalized adjectives** (hostinský, krejčí — declined as adjectives):

| nom        | acc          | dat           | gen          | voc        |
|------------|--------------|---------------|--------------|------------|
| hostinský  | hostinského  | hostinskému   | hostinského  | hostinský  |

Acc and gen coincide.

**Apposition (two declined nouns)** (kostlivec bojovník): both decline.

| nom                    | acc                      | dat                          | gen                       |
|------------------------|--------------------------|------------------------------|---------------------------|
| kostlivec bojovník     | kostlivce bojovníka      | kostlivci bojovníkovi        | kostlivce bojovníka       |

Adjective+noun phrases work the same way (velký hnědý medvěd → velkému hnědému medvědovi).

**Soft adjectives + noun** (obří krysa, koboldí lovec): the soft adjective stays the same in nom/acc/dat/gen for some genders; only the head noun fully declines. Examples:

| nom              | acc               | dat                | gen                |
|------------------|-------------------|--------------------|--------------------|
| obří krysa       | obří krysu        | obří kryse         | obří krysy         |
| koboldí lovec    | koboldího lovce   | koboldímu lovci    | koboldího lovce    |
| koboldí stráž    | koboldí stráž     | koboldí stráži     | koboldí stráže     |

## Patterns to avoid (we don't have nameLoc)

The current schema covers nom/acc/dat/gen/voc only. If a template needs locative outside the singular dat≈loc shortcut, **rephrase** to use a case we have:

| Tempting template            | Better                              |
|------------------------------|-------------------------------------|
| `mluví o {target}` (loc)     | `mluví s {target.dat}` (instr) or rewrite using gen |
| `myslí na {target}`          | already works — `na + acc`          |
| `žije v {target}`            | very rare; rephrase                 |

Plural locative (`o lišcích`, `na medvědech`) doesn't currently come up in our content — if it does, raise it for a schema extension before writing the template.

## Quick decision flow when writing a CS template

1. Find each `{target}` / `{actor}` placeholder in the line.
2. Read the word immediately before it.
3. If it's a preposition: look it up in the table above and add the matching suffix.
4. If it's a verb: pick the case the verb governs (dative for `dát`/`podat`, accusative for most direct-object verbs).
5. If it's possessive ("X's leg/lips"): use gen.
6. If it's the subject of the sentence: use nom (write `{target.nom}` to be explicit, or leave `{target}` if it's the only word — note that bare `{target}` defaults to **acc**, so subject slots need `{target.nom}`).
7. When unsure, prefer rephrasing to use a case we have, rather than inventing new schema fields.

# Exercice — décompiler Brume, modifier une phrase, recompiler

## Le principe

Brume est une application **Electron** : son moteur, ses effets, son interface et toutes
ses phrases sont écrits en JavaScript, puis rangés dans une archive unique :

```
Brume.app/Contents/Resources/app.asar
```

Décompiler Brume, c'est extraire cette archive. On récupère le code **à l'identique**
(noms de variables, commentaires, structure des fichiers), on le modifie librement, puis
on reconstruit l'archive. Aucune contrainte de longueur : on peut rallonger une phrase
autant qu'on veut.

## Les 3 commandes

À lancer depuis le dossier `exercice/` (après `npm run build` à la racine) :

```bash
# 1. Décompiler : copie l'app dans travail/ et extrait le code dans travail/source/
./1-decompiler.sh

# 2. Modifier une phrase (n'importe laquelle, n'importe quelle longueur)
./2-modifier-phrase.sh "Ta météo, ton décor." \
                       "Ta météo, ton décor — et c’est moi qui l’ai décompilée !"

# 3. Recompiler, re-signer et relancer l'app modifiée
./3-recompiler.sh
```

Toutes les phrases sont dans **`travail/source/src/shared/strings.js`** : tu peux aussi
l'ouvrir dans un éditeur et changer ce que tu veux (menu, carte d'accueil, notifications…).
Pour voir le titre modifié : flocon de la barre des menus → « Ouvrir Brume… » (le grand titre de la fenêtre).

## Ce que fait `3-recompiler.sh`, étape par étape

| Étape | Pourquoi |
|---|---|
| `asar pack travail/source app.asar` | reconstruit l'archive à partir du code modifié |
| `tools/asar-integrity.js` | recalcule l'empreinte SHA-256 de l'archive dans `Info.plist` (`ElectronAsarIntegrity`) |
| `tools/adhoc-sign.js` | re-signe l'app : la signature d'origine ne correspond plus au contenu modifié |
| `open travail/Brume.app` | lance la version modifiée |

## Pour aller plus loin (questions à poser au prof)

**Pourquoi c'est si facile avec Electron, et si dur avec KoiArt ?**
KoiArt est compilée en code machine ARM64 (Swift). Ghidra n'en tire qu'un pseudo-code C
approximatif, impossible à recompiler. On ne peut que « patcher » des octets dans le
binaire, et une phrase ne peut pas devenir plus longue sans tout décaler. Brume, elle,
embarque son code source JavaScript : la décompilation est parfaite.

**Comment protéger une app Electron contre ça ?**
1. **Fusibles Electron** `EnableEmbeddedAsarIntegrityValidation` et `OnlyLoadAppFromAsar` :
   l'app refuse de démarrer si `app.asar` ne correspond plus à l'empreinte de `Info.plist`.
   Brume grille déjà les fusibles `RunAsNode`, `NodeOptions` et `NodeCliInspect` (voir
   `package.json`) : personne ne peut se servir de l'app pour exécuter son propre code Node.
   Le fusible d'intégrité est volontairement laissé ouvert, sinon cet exercice échouerait.
2. **Signature Apple + notarisation** : modifier l'app casse la signature officielle, et
   Gatekeeper bloque la version modifiée sur les autres Mac.
3. **Compiler le JavaScript en bytecode V8** (ex. `bytenode`) ou l'obfusquer : le code
   extrait n'est plus lisible.

Notre script recalcule l'empreinte d'intégrité : il passerait la protection n°1. Seules la
signature officielle (n°2) et le bytecode (n°3) résistent vraiment, parce que la clé privée
du développeur n'est pas dans l'app.

## Remettre l'app d'origine

```bash
rm -rf travail      # supprime la copie modifiée
open ../dist/mac-arm64/Brume.app
```

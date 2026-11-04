"""Sur-apprentissage ou sous-apprentissage ? Perte de chaque modèle exporté sur des chants d'entraînement à bruit neuf (tests/donnees/ton-frais.js)
et sur la validation, mêmes variantes, même pondération (moyenne des 7 variantes).

Usage : python -I tests/donnees/ton_perte.py <dossier donnees> <modele> [modele…]   (noms de jeu/ton/reseau/<modele>.json, sans .json)
Écart nettement positif : le modèle connaît les chants d'entraînement (sur-apprentissage). Pertes hautes et égales : sous-apprentissage.
"""
import json, os, sys
import torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ton_reseau as T

V = ['parfait', 'oreille', 'parole', 'modulation', 'concert', 'redecoupe', 'couplets']
A = 'concert-audio'  # à part : la moyenne des 7 reste comparable aux modèles mesurés avant lui


def charge(f):
    d = json.load(open(f, encoding='utf-8'))
    m = T.Reseau(d['H'], 0, d['traits'].get('version', 1)); g = m.gru
    with torch.no_grad():
        for p, k in ((g.weight_ih_l0, 'Wih'), (g.weight_hh_l0, 'Whh'), (g.bias_ih_l0, 'bih'), (g.bias_hh_l0, 'bhh'), (m.out.weight, 'Wo'), (m.out.bias, 'bo')):
            p.copy_(torch.tensor(d[k]))
    return m


def main(dossier, noms):
    R = os.path.join(dossier, 'jeu', 'ton')
    fr = {v: T.lire(os.path.join(R, 'reseau', f'frais-{v}.jsonl')) for v in V}
    va = {v: T.lire(os.path.join(R, f'validation-{v}.jsonl')) for v in V}
    fa, vaA = os.path.join(R, 'reseau', f'frais-{A}.jsonl'), os.path.join(R, f'validation-{A}.jsonl')
    audio = (T.lire(fa), T.lire(vaA)) if os.path.exists(fa) and os.path.exists(vaA) else None
    for nom in noms:
        m = charge(os.path.join(R, 'reseau', nom + '.json'))
        a = [T.evaluer(m, fr[v])[0] for v in V]; b = [T.evaluer(m, va[v])[0] for v in V]
        ca = f' ; {A} {T.evaluer(m, audio[0])[0]:.3f}/{T.evaluer(m, audio[1])[0]:.3f}' if audio else ''
        print(f'{nom} : entraînement à bruit neuf {sum(a) / 7:.4f}, validation {sum(b) / 7:.4f}, écart {(sum(b) - sum(a)) / 7:+.4f} | '
              + ', '.join(f'{v} {x:.3f}/{y:.3f}' for v, x, y in zip(V, a, b)) + ca, flush=True)


if __name__ == '__main__' and len(sys.argv) > 2:
    main(sys.argv[1], sys.argv[2:])

"""Réseau de tonalité : un petit GRU appliqué depuis chacune des 12 toniques (équivariant par transposition), 2 sorties par tonique (majeur, mineur).

Usage : python -I tests/donnees/ton_reseau.py <dossier donnees> [--tailles 16,32,64] [--epoques 25] [--patience 4] [--abandon .1] [--wd 1e-4]
Lit jeu/ton/reseau/lot-*.jsonl (entraînement, un lot par époque, bruit tiré à neuf) et jeu/ton/validation-*.jsonl (figés).
Écrit jeu/ton/reseau/modele-<H>.json (poids du meilleur état sur la validation) et jeu/ton/reseau/courbes.json (pertes par époque).
Garde-fous contre le sur-apprentissage et le sous-apprentissage : perte d'entraînement et de validation suivies à chaque époque,
arrêt quand la validation ne baisse plus (patience), décroissance des poids, abandon sur l'entrée, plusieurs tailles comparées.
Les traits doivent rester identiques à js/raison.js (traits()).
"""
import json, math, os, sys, time, random
import torch, torch.nn as nn, torch.nn.functional as F

PAUSE_MIN, PAUSE_REL, LONG_MAX = .2, .25, 400
POIDS_PAROLE = .5  # poids des notes de parole (cible uniforme) par rapport aux notes chantées
VERSION = 2  # 1 : 4 traits partagés ; 2 : plus le registre (hauteur par rapport au Do du milieu) et la marque « note grave »
NTRAITS = {1: 4, 2: 6}


def traits(notes, version=VERSION):
    """notes [[midi, debut, fin]] -> pcs, traits partagés [log durée, log silence avant, début de phrase, intervalle/12 (, registre, grave)].
    Le registre et la marque grave servent à reconnaître la basse d'un accompagnement (concert) ; communs aux 12 toniques, ils ne trahissent pas la tonalité."""
    pcs, sh, iois, prev = [], [], [], None
    for midi, a, b in notes:
        m = round(midi)
        dur, gap = b - a, (a - prev[2]) if prev else 2.0
        phrase = 0.0
        if prev:
            ioi = a - prev[1]
            if ioi > 0:
                iois.append(ioi)
                if len(iois) > 16:
                    iois.pop(0)
            s = PAUSE_MIN if len(iois) < 4 else max(PAUSE_MIN, PAUSE_REL * sorted(iois)[len(iois) // 2])
            phrase = 1.0 if gap >= s else 0.0
        iv = max(-12, min(12, m - round(prev[0]))) / 12 if prev else 0.0
        pcs.append(m % 12)
        t = [math.log(min(max(dur, .03), 4)), math.log(min(max(gap, .01), 4)), phrase, iv]
        if version >= 2:
            t += [max(-3.0, min(2.0, (m - 60) / 12)), 1.0 if m < 52 else 0.0]
        sh.append(t)
        prev = (midi, a, b)
    return pcs, sh


def exemple(s):
    notes = s['notes'][:LONG_MAX]
    pcs, sh = traits(notes)
    V = s['verite']
    y, w, u = [], [], []
    for i, (midi, a, b) in enumerate(notes):
        v = V[0]
        for x in V:
            if x[0] <= b + 1e-9:
                v = x
        y.append(v[1] * 2 + (0 if v[2] == 'maj' else 1))
        suiv = notes[i + 1][1] if i + 1 < len(notes) else b + .5
        d = min(2.0, max(.05, suiv - a))
        w.append(s.get('poids', 1.0) * d if b >= s['debut'] else 0.0)  # poids < 1 : étiquette douteuse
        u.append(POIDS_PAROLE * d if b < s['debut'] else 0.0)  # avant le chant (parole) : cible « toutes les tonalités également probables »
    return torch.tensor(pcs), torch.tensor(sh, dtype=torch.float32), torch.tensor(y), torch.tensor(w), torch.tensor(u)


def lire(f):
    with open(f, encoding='utf-8') as h:
        return [exemple(json.loads(l)) for l in h if l.strip()]


class Reseau(nn.Module):
    def __init__(s, H, abandon=.1, version=VERSION):
        super().__init__()
        s.H, s.nt = H, NTRAITS[version]
        s.gru = nn.GRU(12 + s.nt, H, batch_first=True)
        s.out = nn.Linear(H, 2)
        s.drop = nn.Dropout(abandon)

    def forward(s, pc, sh):
        B, T = pc.shape
        t = torch.arange(12)
        oh = F.one_hot((pc[:, :, None] - t[None, None, :]) % 12, 12).float()
        x = torch.cat([oh, sh[:, :, None, :].expand(B, T, 12, s.nt)], -1).permute(0, 2, 1, 3).reshape(B * 12, T, 12 + s.nt)
        h, _ = s.gru(s.drop(x))
        return s.out(s.drop(h)).reshape(B, 12, T, 2).permute(0, 2, 1, 3).reshape(B, T, 24)


def lots(data, taille, melange=True):
    idx = sorted(range(len(data)), key=lambda i: len(data[i][0]))
    groupes = [idx[i:i + taille] for i in range(0, len(idx), taille)]
    if melange:
        random.shuffle(groupes)
    for g in groupes:
        T = max(len(data[i][0]) for i in g)
        pc = torch.zeros(len(g), T, dtype=torch.long); sh = torch.zeros(len(g), T, data[g[0]][1].shape[1]); y = torch.zeros(len(g), T, dtype=torch.long); w = torch.zeros(len(g), T); u = torch.zeros(len(g), T)
        for k, i in enumerate(g):
            n = len(data[i][0]); pc[k, :n], sh[k, :n], y[k, :n], w[k, :n], u[k, :n] = data[i]
        yield pc, sh, y, w, u


def evaluer(modele, data):
    modele.eval(); L = J = W = 0.0
    with torch.no_grad():
        for pc, sh, y, w, _ in lots(data, 64, False):
            o = modele(pc, sh); lp = F.log_softmax(o, -1)
            nll = -lp.gather(-1, y[..., None])[..., 0]
            L += float((nll * w).sum()); J += float(((o.argmax(-1) == y).float() * w).sum()); W += float(w.sum())
    return L / W, J / W


def exporter(modele, f, info):
    g = modele.gru
    d = {'H': modele.H, 'I': 12 + modele.nt, 'Wih': g.weight_ih_l0.tolist(), 'Whh': g.weight_hh_l0.tolist(), 'bih': g.bias_ih_l0.tolist(), 'bhh': g.bias_hh_l0.tolist(),
         'Wo': modele.out.weight.tolist(), 'bo': modele.out.bias.tolist(), 'traits': {'pauseMin': PAUSE_MIN, 'pauseRel': PAUSE_REL, 'version': VERSION}, **info}
    with open(f, 'w', encoding='utf-8') as h:
        json.dump(d, h)


def main(dossier, tailles=(16, 32, 64), epoques=25, patience=4, abandon=.1, wd=1e-4):
    torch.manual_seed(1); random.seed(1)
    R = os.path.join(dossier, 'jeu', 'ton')
    lotsF = sorted(os.path.join(R, 'reseau', f) for f in os.listdir(os.path.join(R, 'reseau')) if f.startswith('lot-') and f.endswith('.jsonl'))
    temoin = lire(lotsF[0])[::9]  # échantillon d'entraînement pour comparer les pertes ; les lots sont relus un par époque (mémoire)
    val = {v: lire(os.path.join(R, f'validation-{v}.jsonl')) for v in ('parfait', 'oreille', 'parole', 'modulation', 'concert', 'redecoupe', 'couplets', 'parole-longue', 'concert-audio') if os.path.exists(os.path.join(R, f'validation-{v}.jsonl'))}
    tous_val = [e for l in val.values() for e in l]
    print(f'entraînement : {len(lotsF)} lots de {9 * len(temoin)} suites environ ; validation : {len(tous_val)} suites', flush=True)
    courbes = {}
    for H in tailles:
        modele = Reseau(H, abandon); opt = torch.optim.AdamW(modele.parameters(), lr=3e-3, weight_decay=wd)
        pas = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epoques, eta_min=1e-4)  # pas d'apprentissage qui décroît en cosinus
        meilleur, etat, attente, hist = 1e9, None, 0, []
        for ep in range(epoques):
            modele.train(); t0 = time.time()
            for pc, sh, y, w, u in lots(lire(lotsF[ep % len(lotsF)]), 32):
                o = modele(pc, sh); lp = F.log_softmax(o, -1)
                perte = ((-lp.gather(-1, y[..., None])[..., 0] * w).sum() + (-lp.mean(-1) * u).sum()) / (w.sum() + u.sum()).clamp(min=1e-6)
                opt.zero_grad(); perte.backward(); nn.utils.clip_grad_norm_(modele.parameters(), 1.0); opt.step()
            pas.step()
            pe, je = evaluer(modele, temoin); pv, jv = evaluer(modele, tous_val)
            hist.append({'epoque': ep + 1, 'perteEntr': round(pe, 4), 'perteVal': round(pv, 4), 'justeEntr': round(je, 4), 'justeVal': round(jv, 4)})
            print(f'H={H} époque {ep + 1} : perte entraînement {pe:.4f} ({100 * je:.1f} %), validation {pv:.4f} ({100 * jv:.1f} %), {time.time() - t0:.0f} s', flush=True)
            if pv < meilleur - 1e-4:
                meilleur, attente = pv, 0
                etat = {k: v.clone() for k, v in modele.state_dict().items()}
            else:
                attente += 1
                if attente >= patience:
                    break
        modele.load_state_dict(etat)
        par = {v: evaluer(modele, d) for v, d in val.items()}
        info = {'perteVal': round(meilleur, 4), 'parVariante': {v: {'perte': round(a, 4), 'juste': round(b, 4)} for v, (a, b) in par.items()}, 'epoques': hist}
        exporter(modele, os.path.join(R, 'reseau', f'modele-{H}.json'), info)
        courbes[H] = info
        print(f'H={H} retenu : perte de validation {meilleur:.4f} ; ' + ', '.join(f'{v} {100 * b:.1f} %' for v, (a, b) in par.items()), flush=True)
    with open(os.path.join(R, 'reseau', 'courbes.json'), 'w', encoding='utf-8') as h:
        json.dump(courbes, h, indent=1)


def _auto_test():
    pcs, sh = traits([[60, 0, .5], [62, .5, 1], [64, 1, 1.5], [65, 1.5, 2], [43, 2.6, 3]])
    assert pcs == [0, 2, 4, 5, 7] and sh[4][2] == 1.0 and sh[1][2] == 0.0 and abs(sh[1][3] - 2 / 12) < 1e-9
    assert sh[0][4] == 0.0 and sh[4][5] == 1.0 and abs(sh[4][4] + 17 / 12) < 1e-9
    m = Reseau(8, 0)
    pc = torch.tensor([[0, 4, 7, 0]]); s = torch.zeros(1, 4, NTRAITS[VERSION])
    o1, o2 = m(pc, s), m((pc + 5) % 12, s)
    # transposer de 5 demi-tons fait tourner les 24 sorties de 5 toniques : l'équivariance tient par construction
    assert torch.allclose(o1.reshape(1, 4, 12, 2).roll(5, 2), o2.reshape(1, 4, 12, 2), atol=1e-5)


if __name__ == '__main__':
    _auto_test()
    a = sys.argv[1:]
    if a and not a[0].startswith('--'):
        opt = lambda k, d: a[a.index(k) + 1] if k in a else d
        main(a[0], tuple(int(x) for x in opt('--tailles', '16,32,64').split(',')), int(opt('--epoques', 25)), int(opt('--patience', 4)), float(opt('--abandon', .1)), float(opt('--wd', 1e-4)))
    else:
        print('auto-test OK')

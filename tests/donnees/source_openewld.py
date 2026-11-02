"""OpenEWLD : grilles de chansons anciennes avec accords écrits. Le dépôt se dit libre, mais certains auteurs sont morts après 1956 :
on refait le tri avec les règles de la base de cantiques, sur tous les auteurs du dossier (paroliers compris, faute de savoir qui a écrit quoi).

Usage : python -I tests/donnees/source_openewld.py <dossier extrait d'OpenEWLD (OpenEWLD.db, dataset/)> <dossier de sortie>
Sortie : liste.txt, meta.json, motifs.txt. Les dates des auteurs viennent de secondhandsongs.com (CC BY-NC) : elles servent au tri, elles ne sont pas recopiées.
"""
import json, os, re, sqlite3, sys

ANNEE_LIMITE, DECES_LIMITE = 1931, 1956
INTERDIT = re.compile(r'[<>:"|?*]')  # mêmes remplacements qu'à l'extraction de l'archive sous Windows
norm = lambda s: re.sub(r'[^a-z]', '', s.lower())
an = lambda s: int(s[:4]) if s and re.match(r'\d{4}', s) and s[:4] != '0000' else None


def statut(auteurs, annee, deces):
    if all(a in ('[Traditional]', '[Unknown]') for a in auteurs):
        return ('traditionnel', 'air traditionnel déclaré') if '[Traditional]' in auteurs else (None, 'auteur inconnu')
    morts = [deces.get(norm(a.replace('_', ' '))) for a in auteurs if a not in ('[Traditional]', '[Unknown]')]
    if any(m is None for m in morts):
        return None, 'un auteur sans date de décès'
    if max(morts) >= DECES_LIMITE:
        return None, 'un auteur mort en 1956 ou après'
    if annee is not None and annee >= ANNEE_LIMITE:
        return None, 'publié en 1931 ou après'
    if annee is None and max(morts) > ANNEE_LIMITE - 1:
        return None, 'sans date, auteur mort après 1930'
    return 'date', 'auteurs morts avant %d' % (max(morts) + 1)


def main(src, sortie):
    os.makedirs(sortie, exist_ok=True)
    c = sqlite3.connect(os.path.join(src, 'OpenEWLD.db')).cursor()
    deces = {norm(n): an(d) for n, b, d in c.execute('select common_name, birth, death from authors') if an(d)}
    genres = {}
    for i, g, o in c.execute('select id, genre, occurrences from work_genres'):
        genres.setdefault(i, []).append((o or 0, g))
    meta, motifs, lignes = {}, {}, []
    for i, titre, date, chemin in c.execute('select id, title, first_performance_date, path_leadsheet from works'):
        auteurs = chemin.split('/')[1].split('-')
        s, raison = statut(auteurs, an(date), deces)
        if not s:
            motifs[raison] = motifs.get(raison, 0) + 1
            continue
        local = os.path.join(src, *[INTERDIT.sub('_', p) for p in chemin.split('/')])
        if not os.path.exists(local):
            motifs['fichier absent'] = motifs.get('fichier absent', 0) + 1
            continue
        ident = 'ewld-%d' % i
        g = [x for _, x in sorted(genres.get(i, []), reverse=True)][:2]
        style = ['folk'] if s == 'traditionnel' or 'Folk, World, & Country' in g else ['populaire-ancien']
        meta[ident] = {'source': 'OpenEWLD (Wikifonia)', 'licence': 'domaine public déclaré, MIT pour la base', 'droits': {'statut': s, 'preuve': raison},
                       'style': style, 'titre': titre, 'compositeur': ', '.join(a.replace('_', ' ') for a in auteurs)}
        lignes.append(ident + '\t' + local)
    with open(os.path.join(sortie, 'liste.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lignes) + '\n')
    with open(os.path.join(sortie, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False)
    with open(os.path.join(sortie, 'motifs.txt'), 'w', encoding='utf-8') as f:
        for m, n in sorted(motifs.items(), key=lambda x: -x[1]):
            f.write('%d\t%s\n' % (n, m))
    print('gardés', len(meta), motifs)


def _auto_test():
    d = {norm('Stephen Foster'): 1864, norm('Richard Rodgers'): 1979, norm('Lorenz Hart'): 1943}
    assert statut(['Stephen_Foster'], None, d)[0] == 'date'
    assert statut(['Lorenz_Hart', 'Richard_Rodgers'], 1927, d)[1] == 'un auteur mort en 1956 ou après'
    assert statut(['[Traditional]'], None, d)[0] == 'traditionnel'
    assert statut(['Inconnu_X'], 1900, d)[1] == 'un auteur sans date de décès'


if __name__ == '__main__':
    _auto_test()
    if len(sys.argv) == 3:
        main(sys.argv[1], sys.argv[2])
    else:
        print('auto-test OK')

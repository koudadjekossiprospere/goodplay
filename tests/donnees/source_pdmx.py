"""PDMX : choisit les partitions d'église, de chant traditionnel et de folk dont les droits tiennent, puis les extrait de mxl.tar.gz.

Usage : python -I tests/donnees/source_pdmx.py <dossier PDMX (PDMX.csv, mxl.tar.gz)> <dossier de sortie>
Sortie : liste.txt (identifiant, chemin), meta.json (source, licence, droits, style, titre), motifs.txt (comptes d'exclusion).

La licence MuseScore (domaine public ou CC0) est déclarée par la personne qui a déposé le fichier. Elle ne prouve pas que l'œuvre est libre :
on exige en plus une preuve d'ancienneté (date, compositeur mort avant 1956, air traditionnel) ou une œuvre originale de l'auteur du fichier.
Ceci n'est pas un avis juridique.
"""
import csv, json, os, re, sys, tarfile

ANNEE_LIMITE, DECES_LIMITE = 1931, 1956
EGLISE = re.compile(r'\b(hymn\w*|gospel|church|christ\w*|chora\w*|choir|spiritual|sacred|worship|praise|psalm\w*|carol\w*|religi\w*|satb|'
                    r'cantique\w*|louange|jubilee|no[eë]l|kirchen\w*|chor[aä]l\w*|anthem|doxolog\w*|amen|hallelu\w*|alleluia|jesus|lord|savio\w*|glory|heaven\w*)\b', re.I)
TRAD = re.compile(r'\b(trad(itional|itionnel|\.)?|anon(ymous|yme)?|folk ?song|chanson populaire|volkslied|negro spiritual|african[- ]american spiritual|spiritual|public domain tune|old (english|irish|scottish|welsh) (air|melody))\b', re.I)
# Compositeurs d'airs d'église et de chants anciens, année de décès (tous avant 1956). Nom complet quand le nom seul est ambigu (Bing Crosby, Peter Gabriel, Thelonious Monk...).
I = r'(?:[a-z]+\.?\s+)*'  # prénoms ou initiales facultatifs
CONNUS = [(re.compile(r'\b' + rx + r'\b'), nom, deces) for rx, nom, deces in [
    (r'sankey', 'Ira D. Sankey', 1908), (r'(p\.\s*p\.|philip\s+(p\.\s*)?)\s*bliss', 'Philip P. Bliss', 1876), (r'(w(m|illiam)?\.?\s*b\.?\s*)bradbury', 'William B. Bradbury', 1868),
    (r'(w(m|illiam)?\.?\s*h\.?\s*)doane', 'William H. Doane', 1915), (r'robert\s+(s\.\s*)?lowry|rev\.\s*r(obert)?\.?\s*lowry', 'Robert Lowry', 1899),
    (r'(w(m|illiam)?\.?\s*j(as)?\.?\s*)kirkpatrick', 'William J. Kirkpatrick', 1921), (r'sweney', 'John R. Sweney', 1899), (r'stebbins', 'George C. Stebbins', 1945),
    (r'mcgranahan', 'James McGranahan', 1907), (r'excell', 'Edwin O. Excell', 1921), (r'(charles|chas\.?|c\.)\s*(h\.|hutchinson)?\s*gabriel', 'Charles H. Gabriel', 1932),
    (r'towner', 'Daniel B. Towner', 1919), (r'(george|geo\.?|g\.)\s*(f\.|frederick)?\s*root', 'George F. Root', 1895), (r'lowell\s+mason|\bl\.\s*mason', 'Lowell Mason', 1872),
    (r'thomas\s+hastings|\bt\.\s*hastings', 'Thomas Hastings', 1872), (r'dykes', 'John B. Dykes', 1876), (r'(w(illiam)?\.?\s*h(enry)?\.?\s*)monk', 'William H. Monk', 1889),
    (r'(arthur\s+(s\.\s*)?|a\.\s*s\.\s*)sullivan', 'Arthur Sullivan', 1900), (r'barnby', 'Joseph Barnby', 1896), (r'stainer', 'John Stainer', 1901), (r'henry\s+(t\.\s*)?smart', 'Henry Smart', 1879),
    (r'(samuel\s+(s(ebastian)?\.?\s*)?|s\.\s*s\.\s*)wesley', 'Samuel S. Wesley', 1876), (r'phoebe\s+(p(almer)?\.?\s*)?knapp|mrs\.?\s*j(oseph)?\.?\s*f\.?\s*knapp', 'Phoebe P. Knapp', 1908),
    (r'(w(m|illiam)?\.?\s*g\.?\s*)fischer', 'William G. Fischer', 1912), (r'(charles\s+(c(rozat)?\.?\s*)?|c\.\s*c\.\s*)converse', 'Charles C. Converse', 1909),
    (r'hubert\s+(p\.\s*)?main', 'Hubert P. Main', 1925), (r'(w(illiam)?\.?\s*a\.?\s*)ogden', 'William A. Ogden', 1897), (r'(r(alph)?\.?\s*e\.?\s*)hudson', 'Ralph E. Hudson', 1901),
    (r'(w(illiam)?\.?\s*f\.?\s*)sherwin', 'William F. Sherwin', 1888), (r'oliver\s+holden', 'Oliver Holden', 1844), (r'william\s+billings', 'William Billings', 1800),
    (r'william\s+croft', 'William Croft', 1727), (r'tallis', 'Thomas Tallis', 1585), (r'h[aä]e?ndel', 'G. F. Handel', 1759), (r'haydn', 'Haydn', 1809),
    (r'mendelssohn', 'Felix Mendelssohn', 1847), (r'mozart', 'W. A. Mozart', 1791), (r'beethoven', 'L. van Beethoven', 1827), (r'(j\.\s*s\.\s*|johann\s+sebastian\s+)bach', 'J. S. Bach', 1750),
    (r'gounod', 'Charles Gounod', 1893), (r'adolphe\s+adam', 'Adolphe Adam', 1856), (r'gruber', 'Franz Gruber', 1863), (r'john\s+h(enry)?\.?\s*hopkins', 'John H. Hopkins', 1891),
    (r'redner', 'Lewis Redner', 1908), (r'kocher', 'Conrad Kocher', 1872), (r'gustav\s+holst|\bholst', 'Gustav Holst', 1934), (r'(hubert|c\.\s*h\.\s*h\.)\s*parry', 'Hubert Parry', 1918),
    (r'joseph\s+parry', 'Joseph Parry', 1903), (r'(charles\s+(v(illiers)?\.?\s*)?|c\.\s*v\.\s*)stanford', 'C. V. Stanford', 1924), (r'elgar', 'Edward Elgar', 1934),
    (r'prichard', 'Rowland H. Prichard', 1887), (r'john\s+hughes', 'John Hughes', 1932), (r'john\s+goss', 'John Goss', 1880), (r'elvey', 'George J. Elvey', 1893),
    (r'john\s+hatton', 'John Hatton', 1793), (r'darwall', 'John Darwall', 1789), (r'cr[uü]e?ger', 'Johann Crüger', 1662), (r'joachim\s+neander|\bneander', 'Joachim Neander', 1680),
    (r'martin\s+luther', 'Martin Luther', 1546), (r'teschner', 'Melchior Teschner', 1635), (r'philipp?\s+nicolai', 'Philipp Nicolai', 1608), (r'vulpius', 'Melchior Vulpius', 1615),
    (r'praetorius', 'Michael Praetorius', 1621), (r'louis\s+bourgeois', 'Louis Bourgeois', 1561), (r'goudimel', 'Claude Goudimel', 1572), (r'c[ée]sar\s+malan', 'César Malan', 1864),
    (r'saillens', 'Ruben Saillens', 1942), (r'tindley', 'Charles A. Tindley', 1933), (r'bilhorn', 'Peter P. Bilhorn', 1936), (r'zundel', 'John Zundel', 1882),
    (r'(george\s+(j(ames)?\.?\s*)?|g\.\s*j\.\s*)webb', 'George J. Webb', 1887), (r'woodbury', 'Isaac B. Woodbury', 1858), (r'fanny\s+(j(ane)?\.?\s*)?crosby', 'Fanny Crosby', 1915),
    (r'(h(oratio)?\.?\s*r(ichmond)?\.?\s*)palmer', 'Horatio R. Palmer', 1907), (r'(e(dmund)?\.?\s*s\.?\s*)lorenz', 'Edmund S. Lorenz', 1942), (r'(j(ames)?\.?\s*h\.?\s*)fillmore', 'James H. Fillmore', 1936),
    (r'stephen\s+(c(ollins)?\.?\s*)?foster', 'Stephen Foster', 1864), (r'schubert', 'Franz Schubert', 1828), (r'brahms', 'Johannes Brahms', 1897), (r'c[ée]sar\s+franck', 'César Franck', 1890),
    (r'bortniansky', 'Dmitry Bortniansky', 1825), (r'leontovy?ch', 'Mykola Leontovych', 1921), (r'tchaikovsky', 'P. I. Tchaikovsky', 1893), (r'arcadelt', 'Jacques Arcadelt', 1568),
    (r'palestrina', 'G. P. da Palestrina', 1594), (r'purcell', 'Henry Purcell', 1695), (r'sch[uü]e?tz', 'Heinrich Schütz', 1672), (r'grieg', 'Edvard Grieg', 1907),
    (r'(simeon\s+(b\.\s*)?|s\.\s*b\.\s*)marsh', 'Simeon B. Marsh', 1875), (r'(william\s+(h(oward)?\.?\s*)?|w\.\s*h\.\s*)doane', 'William H. Doane', 1915),
]]
# Auteurs récents souvent déposés à tort comme libres (cherchés dans les champs d'auteur), titres récents distinctifs, culture populaire : exclus d'office.
RECENTS_AUTEURS = re.compile(r'\b(hillsong|tomlin|redman|matt maher|elevation worship|bethel|kari jobe|getty|townend|zschech|michael w\.? smith|'
                             r'steven curtis chapman|crowder|jesus culture|wickham|daigle|casting crowns|mercyme|brenton brown|baloche|don moen|'
                             r'kenoly|integrity music|vineyard|maverick city|upperroom|kirk franklin|mcclurkin|fred hammond|israel houghton|winans|'
                             r'sinach|nathaniel bassey|dena mwana|mbiye|athoms|kalambay|lord lombo|gael music|mulaja|dan luiten|jeunesse en mission|'
                             r'matt marvane|hosanna! music|brumley|thomas a\.? dorsey|vaughan williams|sibelius|rutter|lauridsen|whitacre|chilcott|'
                             r'gjeilo|leonard cohen)\b', re.I)
RECENTS_TITRES = re.compile(r'10,?000 reasons|way ?maker|how great is our god|shout to the lord|in christ alone|goodness of god|build my life|'
                            r'what a beautiful name|reckless love|blessed be your name|here i am to worship|open the eyes of my heart|'
                            r'lord i lift your name|great are you lord|mighty to save|living hope|graves into gardens|holy spirit,? you are welcome|'
                            r'revelation song|you raise me up|i\'ll fly away|precious lord,? take my hand|peace in the valley|total praise|'
                            r'oceans \(where feet|amazing grace \(my chains', re.I)
POPULAIRE = re.compile(r'\b(star wars|disney|frozen|pok[eé]mon|minecraft|undertale|zelda|super mario|anime|naruto|genshin|fortnite|harry potter)\b', re.I)
STYLE = [('gospel', re.compile(r'gospel|sankey|bliss|crosby|doane|lowry|kirkpatrick|sweney|excell|gabriel|towner|stebbins|mcgranahan|bilhorn|tindley', re.I)),
         ('spiritual', re.compile(r'spiritual|jubilee', re.I)), ('noel', re.compile(r'carol|christmas|noel|noël|weihnacht|advent', re.I)),
         ('cantique', re.compile(r'hymn|chorale|choral|psalm|church|cantique|kirchen|satb|anthem|doxolog', re.I)),
         ('folk', re.compile(r'folk|traditional|volkslied|chanson populaire|ballad', re.I))]
ANNEES = re.compile(r'(?<!\d)(1[0-9]{3}|20[0-9]{2})(?!\d)')
VIE = re.compile(r'\(\s*(?:c\.?|ca\.?|circa)?\s*(1[0-9]{3})?\s*[-\u2013]+\s*(1[0-9]{3}|20[0-9]{2})?\s*\)')  # trait d'union ou tiret demi-cadratin


def droits(row):
    """Renvoie (statut, motif ou preuve)."""
    champs = ' '.join(row.get(k) or '' for k in ('title', 'song_name', 'subtitle', 'composer_name', 'artist_name', 'publisher'))
    auteurs = ' '.join([row.get('composer_name') or '', row.get('artist_name') or '', row.get('subtitle') or '', row.get('publisher') or '', (row.get('title') or '').rpartition(' - ')[2]]).lower()
    if RECENTS_AUTEURS.search(auteurs) or RECENTS_TITRES.search(champs) or POPULAIRE.search(champs + ' ' + (row.get('tags') or '')):
        return None, 'auteur ou chant récent connu'
    if row.get('license_conflict') == 'True':
        return None, 'licence contradictoire dans le fichier'
    # « Œuvre originale » est déclaré à la légère (arrangements de l'air d'un autre, vus à la relecture) : cela ne prouve rien, on cherche une autre preuve.
    vies = VIE.findall(champs)
    deces = [int(d) for _, d in vies if d]
    if deces and max(deces) >= DECES_LIMITE:
        return None, 'auteur mort en 1956 ou après'
    annees = [int(a) for a in ANNEES.findall(champs)]
    if annees and max(annees) >= ANNEE_LIMITE and not (deces and max(annees) <= max(deces)):
        return None, 'date de 1931 ou après'
    if deces:
        return 'date', 'auteur mort en %d' % max(deces)
    connus = [(n, d) for rx, n, d in CONNUS if rx.search(auteurs)]
    if connus:
        n, d = max(connus, key=lambda x: x[1])
        return 'compositeur', '%s (mort en %d)' % (n, d)
    if TRAD.search(champs):
        # Un compositeur nommé, sans dates, l'emporte sur « traditionnel » écrit ailleurs ; un arrangeur nommé ne change rien à l'air.
        comp = (row.get('composer_name') or '').strip()
        if comp and comp.upper() != 'NA' and not TRAD.search(comp) and not re.search(r'\b(arr|harm|arrang|setting|bearb|transcr)', comp, re.I):
            return None, 'compositeur nommé sans dates, air dit traditionnel ailleurs'
        return 'traditionnel', 'air traditionnel déclaré'
    # Même règle que la base de cantiques : une personne sans dates passe seulement si l'œuvre est d'avant 1880.
    if annees and max(annees) < 1880:
        return 'date', 'daté de %d' % max(annees)
    if annees:
        return None, 'auteur sans dates, œuvre de 1880 ou après'
    return None, "pas de preuve d'ancienneté"


def style(row):
    txt = ' '.join(row.get(k) or '' for k in ('genres', 'groups', 'tags', 'title', 'subtitle', 'composer_name'))
    return [s for s, rx in STYLE if rx.search(txt)] or ['autre']


def candidat(row):
    txt = ' '.join(row.get(k) or '' for k in ('genres', 'groups', 'tags', 'title', 'song_name', 'subtitle', 'composer_name'))
    try:
        nt = int(float(row.get('n_tracks') or 0))
    except ValueError:
        nt = 0
    if not (1 <= nt <= 6) or row.get('mxl') in ('', 'NA', None):
        return False
    return bool(EGLISE.search(txt) or 'folk' in (row.get('genres') or '') or TRAD.search(txt)
                or any(rx.search((row.get('composer_name') or '').lower()) for rx, _, _ in CONNUS))


def main(src, sortie):
    os.makedirs(sortie, exist_ok=True)
    csv.field_size_limit(10 ** 9)
    garde, motifs = {}, {}
    with open(os.path.join(src, 'PDMX.csv'), newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            if not candidat(row):
                continue
            if row.get('subset:deduplicated') != 'True':
                motifs['doublon PDMX (titre et instrumentation)'] = motifs.get('doublon PDMX (titre et instrumentation)', 0) + 1
                continue
            statut, raison = droits(row)
            if not statut:
                motifs[raison] = motifs.get(raison, 0) + 1
                continue
            ident = 'pdmx-' + os.path.splitext(os.path.basename(row['mxl']))[0]
            st, an = style(row), re.search(r'mort en (\d{4})', raison)
            if st == ['autre'] and an and int(an.group(1)) < 1700:
                st = ['ancien']  # polyphonie de la Renaissance ou du début du baroque : loin du chant d'assemblée
            garde[ident] = {'mxl': row['mxl'].lstrip('./'), 'meta': {
                'source': 'PDMX (MuseScore)', 'licence': row['license'], 'droits': {'statut': statut, 'preuve': raison},
                'style': st, 'titre': (row.get('title') or row.get('song_name') or '').strip()[:120],
                'compositeur': (row.get('composer_name') or '').strip()[:120], 'note': float(row.get('rating') or 0)}}
    voulus = {v['mxl']: k for k, v in garde.items()}
    dest = os.path.join(sortie, 'mxl')
    os.makedirs(dest, exist_ok=True)
    n = 0
    with tarfile.open(os.path.join(src, 'mxl.tar.gz'), 'r|gz') as tar:
        for m in tar:
            nom = m.name.lstrip('./')
            if m.isfile() and nom in voulus:
                cible = os.path.join(dest, voulus[nom] + '.mxl')  # nom fixé par nous : aucun chemin de l'archive n'est réutilisé
                with tar.extractfile(m) as fsrc, open(cible, 'wb') as fdst:
                    fdst.write(fsrc.read())
                n += 1
    with open(os.path.join(sortie, 'liste.txt'), 'w', encoding='utf-8') as f:
        for k in garde:
            p = os.path.join(dest, k + '.mxl')
            if os.path.exists(p):
                f.write(k + '\t' + p + '\n')
    with open(os.path.join(sortie, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump({k: v['meta'] for k, v in garde.items() if os.path.exists(os.path.join(dest, k + '.mxl'))}, f, ensure_ascii=False, indent=0)
    with open(os.path.join(sortie, 'motifs.txt'), 'w', encoding='utf-8') as f:
        for m, c in sorted(motifs.items(), key=lambda x: -x[1]):
            f.write('%d\t%s\n' % (c, m))
    stat = {}
    for v in garde.values():
        stat[v['meta']['droits']['statut']] = stat.get(v['meta']['droits']['statut'], 0) + 1
    print('gardés', len(garde), 'extraits', n, stat)
    print(open(os.path.join(sortie, 'motifs.txt'), encoding='utf-8').read())


def _auto_test():
    r = lambda **k: {'title': '', 'song_name': '', 'subtitle': '', 'composer_name': '', 'artist_name': '', 'publisher': '', 'license_conflict': 'False', 'is_original': 'False', **k}
    assert droits(r(title='Way Maker', composer_name='Sinach'))[0] is None
    assert droits(r(title='Glorious Things of Thee Are Spoken', composer_name='Joseph Haydn'))[0] == 'compositeur'
    assert droits(r(title='I Surrender All', composer_name='Winfield S. Weeden (1847-1908)'))[0] == 'date'
    assert droits(r(title='Blessed Assurance', composer_name='Phoebe Palmer Knapp'))[0] == 'compositeur'
    assert droits(r(title='Hymn', composer_name='John Smith (1901-1960)'))[1] == 'auteur mort en 1956 ou après'
    assert droits(r(title='Glorious day - L. B. Shook 1883'))[1] == 'auteur sans dates, œuvre de 1880 ou après'
    assert droits(r(title='Praise his name - Charles H. Gabriel'))[1] == 'Charles H. Gabriel (mort en 1932)'
    assert droits(r(title='White Christmas', composer_name='Bing Crosby'))[0] is None
    assert droits(r(title='Song 1945'))[1] == 'date de 1931 ou après'
    assert droits(r(title='Shenandoah', composer_name='Traditional'))[0] == 'traditionnel'
    assert droits(r(title='Alma Mater (traditional)', composer_name='J. C. Harris'))[0] is None
    assert droits(r(title='Poe (traditional)', composer_name='Harmonisation Jean Dupont'))[0] == 'traditionnel'
    assert droits(r(title='Mon chant'))[0] is None
    assert droits(r(title='Abide with me', composer_name='W. H. Monk (1823-1889)'))[1] == 'auteur mort en 1889'


if __name__ == '__main__':
    _auto_test()
    if len(sys.argv) == 3:
        main(sys.argv[1], sys.argv[2])
    else:
        print('auto-test OK')

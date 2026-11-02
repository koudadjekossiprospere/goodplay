"""Lit des partitions MusicXML (.mxl, .musicxml, .xml) et écrit, pour chacune, un JSON intermédiaire sans paroles.

Usage : python -I tests/donnees/lire_musicxml.py <liste.txt> <dossier de sortie>
  liste.txt : une ligne par partition, « identifiant<TAB>chemin ».

Sortie, temps en noires depuis le début :
  {id, titre, createurs:{compositeur, arrangeur, parolier}, droits, logiciel, tempo (noires par minute ou null),
   mesures:[{t, n, duree, sig:[a,b], quintes, mode}], voix:[{cle, nom, syllabes, evts:[{t, d, p:[midi], lie, point}]}],
   harmonies:[{t, racine, q, basse}], respirations:[t], reprises, voltas, transpositeurs}
Les paroles servent seulement à compter les syllabes de chaque voix (la voix chantée en porte le plus) : aucun texte n'est écrit.
"""
import json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

PAS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
# Qualités MusicXML vers les codes de js/theorie.js ; 'dim' (triade diminuée) et 'N' (sans accord) n'y existent pas.
KIND = {
    'major': 'maj', 'minor': 'min', 'augmented': 'aug', 'diminished': 'dim', 'dominant': '7', 'major-seventh': 'maj7',
    'minor-seventh': 'm7', 'diminished-seventh': 'dim7', 'augmented-seventh': '7', 'half-diminished': 'm7b5',
    'major-minor': 'mmaj7', 'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'maj9',
    'minor-ninth': 'm9', 'dominant-11th': '11', 'major-11th': 'maj7', 'minor-11th': 'm11', 'dominant-13th': '13',
    'major-13th': 'maj13', 'minor-13th': 'm9', 'suspended-second': 'sus2', 'suspended-fourth': 'sus4',
    'power': '5', 'pedal': 'maj', 'none': 'N', 'Neapolitan': 'maj', 'Italian': '7', 'French': '7', 'German': '7', 'Tristan': 'm7b5'
}
# Quand <kind> vaut 'other' ou manque, le texte affiché fait foi.
TEXTE = [(r'^(m|min|-)(7|9|11|13)?$', None), (r'^(maj|M|Δ)', 'maj7'), (r'^(dim|o|°)7', 'dim7'), (r'^(dim|o|°)$', 'dim'),
         (r'^(ø|m7b5|min7b5)', 'm7b5'), (r'^sus2', 'sus2'), (r'^7?sus', 'sus4'), (r'^(\+|aug)', 'aug'), (r'^6', '6'),
         (r'^7', '7'), (r'^9', '9'), (r'^$', 'maj')]


def qualite(kind_el):
    if kind_el is None:
        return 'maj'
    k, txt = (kind_el.text or '').strip(), (kind_el.get('text') or '').strip()
    if k in KIND and k != 'other':
        return KIND[k]
    for motif, q in TEXTE:
        m = re.match(motif, txt)
        if m:
            return q or ('min' if not m.group(2) else 'm7' if m.group(2) == '7' else 'm9' if m.group(2) == '9' else 'm11')
    return 'maj'


def hauteur(step, alter, octave):
    return 12 * (int(octave) + 1) + PAS[step] + round(float(alter or 0))


def ouvrir(chemin):
    if chemin.lower().endswith('.mxl'):
        z = zipfile.ZipFile(chemin)
        noms = z.namelist()
        principal = None
        if 'META-INF/container.xml' in noms:
            try:
                c = ET.fromstring(z.read('META-INF/container.xml'))
                principal = next((r.get('full-path') for r in c.iter() if r.tag.endswith('rootfile') and r.get('full-path')), None)
            except ET.ParseError:  # vu dans OpenEWLD : apostrophe du titre non échappée dans container.xml
                pass
        if principal not in noms:
            principal = next(n for n in noms if n.lower().endswith(('.xml', '.musicxml')) and not n.startswith('META-INF'))
        return ET.fromstring(z.read(principal))
    return ET.parse(chemin).getroot()


def texte(el, chemin):
    x = el.find(chemin)
    return (x.text or '').strip() if x is not None and x.text else ''


def lire(chemin):
    racine = ouvrir(chemin)
    if racine.tag != 'score-partwise':
        raise ValueError('format ' + racine.tag)
    createurs = {}
    for c in racine.iter('creator'):
        createurs.setdefault(c.get('type') or 'autre', (c.text or '').strip())
    titre = texte(racine, 'work/work-title') or texte(racine, 'movement-title')
    droits = ' | '.join((r.text or '').strip() for r in racine.iter('rights') if r.text)
    logiciel = texte(racine, 'identification/encoding/software')
    noms = {sp.get('id'): texte(sp, 'part-name') for sp in racine.iter('score-part')}
    percu = {sp.get('id') for sp in racine.iter('score-part') for ch in sp.iter('midi-channel') if (ch.text or '').strip() == '10'}

    mesures, voix, harmonies, respirations = [], {}, [], []
    reprises = voltas = False
    transpositeurs = []
    src_h = None  # les harmonies viennent de la première partie qui en porte
    tempo = None
    voltas_mes, volta_courante = [], None
    ip = -1
    for part in racine.findall('part'):
        pid = part.get('id')
        if pid in percu:
            continue
        ip += 1
        div, t0, sig, quintes, mode, transp = 1, 0.0, [4, 4], 0, None, 0
        for mesure in part.findall('measure'):
            pos, fin, prec = 0, 0, 0
            volta_mesure = volta_courante
            for el in mesure:
                tag = el.tag
                if tag == 'attributes':
                    if el.find('divisions') is not None:
                        div = int(float(el.find('divisions').text))
                    ti = el.find('time')
                    if ti is not None and ti.find('beats') is not None:
                        try:
                            sig = [int(ti.find('beats').text.split('+')[0]), int(ti.find('beat-type').text)]
                        except ValueError:
                            pass
                    ke = el.find('key')
                    if ke is not None and ke.find('fifths') is not None:
                        quintes, mode = int(ke.find('fifths').text), texte(ke, 'mode') or None
                    tr = el.find('transpose')
                    if tr is not None:
                        transp = int(float(texte(tr, 'chromatic') or 0)) + 12 * int(float(texte(tr, 'octave-change') or 0))
                        if transp and pid not in transpositeurs:
                            transpositeurs.append(pid)
                    if el.find('clef/sign') is not None and texte(el, 'clef/sign') == 'percussion':
                        percu.add(pid)
                elif tag == 'backup':
                    pos -= int(float(el.find('duration').text))
                elif tag == 'forward':
                    pos += int(float(el.find('duration').text))
                    fin = max(fin, pos)
                elif tag == 'harmony' and src_h in (None, pid):
                    r = el.find('root')
                    if r is None:
                        continue
                    src_h = pid
                    off = int(float(texte(el, 'offset') or 0))
                    b = el.find('bass')
                    harmonies.append({
                        't': round(t0 + (pos + off) / div, 6),
                        'racine': (PAS[texte(r, 'root-step')] + round(float(texte(r, 'root-alter') or 0))) % 12,
                        'q': qualite(el.find('kind')),
                        'basse': None if b is None else (PAS[texte(b, 'bass-step')] + round(float(texte(b, 'bass-alter') or 0))) % 12
                    })
                elif tag in ('direction', 'sound') and tempo is None:
                    s = el if tag == 'sound' else el.find('sound')
                    if s is not None and s.get('tempo'):
                        tempo = float(s.get('tempo'))
                elif tag == 'barline':
                    if el.find('repeat') is not None:
                        reprises = True
                    en = el.find('ending')
                    if en is not None:
                        voltas = True
                        if ip == 0:
                            nums = {int(x) for x in re.findall(r'\d+', en.get('number') or '')} or {1}
                            if en.get('type') == 'start':
                                volta_courante = volta_mesure = nums
                            else:
                                volta_mesure, volta_courante = volta_courante or nums, None
                elif tag == 'note':
                    if el.find('grace') is not None or el.find('cue') is not None:
                        continue
                    d = int(float(texte(el, 'duration') or 0))
                    accord = el.find('chord') is not None
                    debut = prec if accord else pos
                    cle = f"{pid}/{texte(el, 'staff') or '1'}/{texte(el, 'voice') or '1'}"
                    v = voix.setdefault(cle, {'cle': cle, 'nom': noms.get(pid, ''), 'syllabes': 0, 'evts': []})
                    if el.find('lyric') is not None:
                        v['syllabes'] += 1
                    t = round(t0 + debut / div, 6)
                    p = None
                    if el.find('pitch') is not None:
                        pe = el.find('pitch')
                        p = hauteur(texte(pe, 'step'), texte(pe, 'alter'), texte(pe, 'octave')) + transp
                    elif el.find('unpitched') is not None:
                        continue
                    lie = any(x.get('type') == 'start' for x in el.findall('tie'))
                    point = el.find('notations/fermata') is not None
                    if el.find('notations/articulations/breath-mark') is not None or el.find('notations/articulations/caesura') is not None:
                        respirations.append(round(t + d / div, 6))
                    if accord and v['evts'] and abs(v['evts'][-1]['t'] - t) < 1e-6:
                        e = v['evts'][-1]
                        if p is not None:
                            e['p'].append(p)
                        e['lie'] = e['lie'] or lie
                        e['point'] = e['point'] or point
                    else:
                        v['evts'].append({'t': t, 'd': round(d / div, 6), 'p': [] if p is None else [p], 'lie': lie, 'point': point})
                    if not accord:
                        prec = pos
                        pos += d
                    fin = max(fin, pos)
            duree = fin / div
            if ip == 0:
                mesures.append({'t': round(t0, 6), 'n': mesure.get('number'), 'duree': round(duree, 6), 'sig': sig, 'quintes': quintes, 'mode': mode})
                voltas_mes.append(volta_mesure)
            t0 += duree
    voix = [v for v in voix.values() if v['cle'].split('/')[0] not in percu and any(e['p'] for e in v['evts'])]
    for v in voix:
        v['evts'].sort(key=lambda e: e['t'])
    harmonies.sort(key=lambda h: h['t'])
    # Fins alternatives : on garde la dernière, comme une reprise jouée une seule fois, et on recolle le temps.
    retirees = 0
    if any(voltas_mes):
        derniere = max(n for s in voltas_mes if s for n in s)
        trous = [(m['t'], m['t'] + m['duree']) for m, s in zip(mesures, voltas_mes) if s and derniere not in s]
        retirees = len(trous)
        dedans = lambda t: any(a - 1e-6 <= t < b - 1e-6 for a, b in trous)
        avant = lambda t: round(t - sum(min(b, t) - a for a, b in trous if a < t), 6)
        mesures = [{**m, 't': avant(m['t'])} for m in mesures if not dedans(m['t'])]
        for v in voix:
            v['evts'] = [{**e, 't': avant(e['t'])} for e in v['evts'] if not dedans(e['t'])]
        harmonies = [{**h, 't': avant(h['t'])} for h in harmonies if not dedans(h['t'])]
        respirations = [avant(t) for t in respirations if not dedans(t - 1e-3)]
        voltas = False
    return {'titre': titre, 'createurs': createurs, 'droits': droits, 'logiciel': logiciel, 'tempo': tempo, 'mesures': mesures, 'voix': voix,
            'harmonies': harmonies, 'respirations': sorted(set(respirations)), 'reprises': reprises, 'voltas': voltas,
            'finsRetirees': retirees, 'transpositeurs': transpositeurs}


def main(liste, sortie):
    os.makedirs(sortie, exist_ok=True)
    ok = ko = 0
    erreurs = {}
    with open(liste, encoding='utf-8') as f:
        lignes = [l.rstrip('\n').split('\t') for l in f if l.strip()]
    for ident, chemin in lignes:
        cible = os.path.join(sortie, ident + '.json')
        if os.path.exists(cible):
            ok += 1
            continue
        try:
            r = lire(chemin)
            r['id'] = ident
            with open(cible, 'w', encoding='utf-8') as g:
                json.dump(r, g, ensure_ascii=False, separators=(',', ':'))
            ok += 1
        except Exception as e:  # une partition illisible ne bloque pas les autres : on compte le motif
            ko += 1
            m = type(e).__name__ + ': ' + str(e)[:60]
            erreurs[m] = erreurs.get(m, 0) + 1
    print(f'lues {ok}, illisibles {ko}')
    for m, n in sorted(erreurs.items(), key=lambda x: -x[1])[:15]:
        print(f'  {n}\t{m}')


def _auto_test():
    # Deux voix, un accord plaqué, une liaison, une transposition, un point d'orgue, une harmonie décalée : rien ne doit se perdre.
    xml = '''<score-partwise><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>-1</fifths><mode>major</mode></key>
    <time><beats>3</beats><beat-type>4</beat-type></time><transpose><chromatic>-2</chromatic></transpose></attributes>
    <harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind text="m7">minor-seventh</kind><offset>2</offset></harmony>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><tie type="start"/><lyric><text>a</text></lyric></note>
    <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><notations><fermata/></notations></note>
    <backup><duration>6</duration></backup>
    <note><pitch><step>F</step><octave>3</octave></pitch><duration>6</duration><voice>2</voice></note>
    </measure></part></score-partwise>'''
    import tempfile
    d = tempfile.mkdtemp()
    p = os.path.join(d, 'a.xml')
    with open(p, 'w') as f:
        f.write(xml)
    r = lire(p)
    v1 = next(v for v in r['voix'] if v['cle'] == 'P1/1/1')
    v2 = next(v for v in r['voix'] if v['cle'] == 'P1/1/2')
    assert v1['evts'][0]['p'] == [70, 62] and v1['evts'][0]['lie'], v1['evts'][0]
    assert v1['evts'][1] == {'t': 1.0, 'd': 2.0, 'p': [70], 'lie': False, 'point': True}, v1['evts'][1]
    assert v2['evts'][0]['p'] == [51] and v2['evts'][0]['d'] == 3.0
    assert v1['syllabes'] == 1 and r['mesures'][0]['duree'] == 3.0 and r['mesures'][0]['quintes'] == -1
    assert r['harmonies'] == [{'t': 1.0, 'racine': 10, 'q': 'm7', 'basse': None}], r['harmonies']
    # Fins alternatives : la 1re fin (mesure 2) disparaît, la 2e fin recule d'une mesure, ses notes et son accord avec elle.
    m = lambda n, h, extra='': f'<measure number="{n}">{extra}<note><pitch><step>{h}</step><octave>4</octave></pitch><duration>4</duration></note></measure>'
    xml = ('<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">'
           + m(1, 'C', '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>')
           + m(2, 'D', '<barline location="left"><ending number="1" type="start"/></barline>').replace('</measure>', '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>')
           + m(3, 'E', '<barline location="left"><ending number="2" type="start"/></barline><harmony><root><root-step>A</root-step></root><kind>minor</kind></harmony>').replace('</measure>', '<barline location="right"><ending number="2" type="discontinue"/></barline></measure>')
           + m(4, 'F') + '</part></score-partwise>')
    with open(p, 'w') as f:
        f.write(xml)
    r = lire(p)
    assert [e['p'][0] for e in r['voix'][0]['evts']] == [60, 64, 65] and [e['t'] for e in r['voix'][0]['evts']] == [0, 4, 8], r['voix'][0]['evts']
    assert r['finsRetirees'] == 1 and not r['voltas'] and [x['t'] for x in r['mesures']] == [0, 4, 8] and r['harmonies'][0]['t'] == 4


if __name__ == '__main__':
    _auto_test()
    if len(sys.argv) == 3:
        main(sys.argv[1], sys.argv[2])
    else:
        print('auto-test OK')

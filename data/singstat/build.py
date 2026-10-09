"""
THE POPULATION'S SOURCES, COMPILED
---------------------------------------------------------------------
Reads the official tables in data/singstat/raw and writes
agents/population-data.json, which agents/population.js draws every
persona from. Nothing in the output is typed in by hand except the two
mappings below (planning area -> region, engine industry -> SSIC
industry), and both are stated where they are defined.

    python data/singstat/build.py            rebuild from the saved tables
    python data/singstat/build.py --fetch    download the tables again first

Needs openpyxl for the three Ministry of Manpower workbooks, and curl for --fetch.
"""
import json, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
OUT = os.path.join(HERE, '..', '..', 'agents', 'population-data.json')

API = 'https://tablebuilder.singstat.gov.sg/api/table/tabledata/%s?limit=5000'
MOM = 'https://stats.mom.gov.sg/iMAS_Tables1/LabourForce/LabourForce_2025/LFR2025_Section%s.xlsx'

SINGSTAT = {
    'M810011': 'ethnicity by age; ages of people 65 and over',
    'M810381': 'type of home by age',
    'M810891': 'who people live with, by age',
    'M810571': 'number of children',
    'M182131': 'ages of workers in each industry; which industries older workers are in',
    'C020102': 'income position by type of home',
    'C020125': 'region by type of home',
    'C020175': 'health by age',
}
MOM_TABLES = {
    'A': ('A4', 'share of people 65 and over still working; unemployed and outside the labour force by age'),
    'C': ('C13', 'income position by industry'),
    'L': ('L7', 'why working-age people are not working: studying, caring, retired early, other'),
}

# ---------------------------------------------------------------------
# MAPPING 1, typed in: the 55 planning areas of the URA Master Plan 2019
# and the five planning regions they belong to. SingStat publishes
# residents by planning area; the region is the URA's grouping.
# ---------------------------------------------------------------------
REGION = {
    'central': ['Bishan', 'Bukit Merah', 'Bukit Timah', 'Downtown Core', 'Geylang', 'Kallang', 'Marina East',
                'Marina South', 'Marine Parade', 'Museum', 'Newton', 'Novena', 'Orchard', 'Outram', 'Queenstown',
                'River Valley', 'Rochor', 'Singapore River', 'Southern Islands', 'Straits View', 'Tanglin', 'Toa Payoh'],
    'east': ['Bedok', 'Changi', 'Changi Bay', 'Pasir Ris', 'Paya Lebar', 'Tampines'],
    'north': ['Central Water Catchment', 'Lim Chu Kang', 'Mandai', 'Sembawang', 'Simpang', 'Sungei Kadut',
              'Woodlands', 'Yishun'],
    'north_east': ['Ang Mo Kio', 'Hougang', 'North-Eastern Islands', 'Punggol', 'Seletar', 'Sengkang', 'Serangoon'],
    'west': ['Boon Lay', 'Bukit Batok', 'Bukit Panjang', 'Choa Chu Kang', 'Clementi', 'Jurong East', 'Jurong West',
             'Pioneer', 'Tengah', 'Tuas', 'Western Islands', 'Western Water Catchment'],
}
AREA_REGION = {a.lower(): r for r, areas in REGION.items() for a in areas}

# ---------------------------------------------------------------------
# MAPPING 2, typed in: which published industry (SSIC 2020 section)
# stands in for each of the scenario's thirteen industries. A judgement,
# and a coarse one: healthcare and care share one published industry,
# as do education, public administration and public safety. Four
# published industries (professional services, administrative and
# support, arts and recreation, other community and personal services)
# have no counterpart in the scenario and are not used.
# ---------------------------------------------------------------------
INDUSTRY = {
    'healthcare': ['Health & Social Services'],
    'care_services': ['Health & Social Services'],
    'education_research': ['Public Administration & Education'],
    'transport_logistics': ['Transportation & Storage'],
    'energy_utilities': ['Others'],
    'compute_telecom': ['Information & Communications'],
    'housing_construction': ['Construction', 'Real Estate Services'],
    'food_agri': ['Accommodation & Food Services'],
    'manufacturing': ['Manufacturing'],
    'finance': ['Financial & Insurance Services'],
    'retail_commerce': ['Wholesale & Retail Trade'],
    'public_admin': ['Public Administration & Education'],
    'public_safety': ['Public Administration & Education'],
}

DWELLINGS = ['hdb_1_2', 'hdb_3', 'hdb_4', 'hdb_5', 'condo', 'landed']


def get(url):
    """Through curl: the statistics site turns away Python's own client."""
    import subprocess
    out = subprocess.run(['curl', '-sS', '-f', '-m', '90', '-A', 'Mozilla/5.0', url], capture_output=True)
    if out.returncode != 0:
        raise SystemExit('could not fetch ' + url + ': ' + out.stderr.decode('utf-8', 'replace').strip())
    return out.stdout


def fetch():
    """The API returns at most about 5,000 cells and cuts a larger table short without saying so. A time series
    is therefore asked for its latest period only, which every table here fits inside."""
    os.makedirs(RAW, exist_ok=True)
    for tid in SINGSTAT:
        raw = get(API % tid)
        d = json.loads(raw)['Data']
        if tid.startswith('M'):
            latest = d['row'][0]['columns'][-1]['key']
            raw = get((API % tid) + '&timeFilter=' + latest)
            d = json.loads(raw)['Data']
        cells = sum(len(flat(r['columns'])) for r in d['row'])
        if cells >= 4900:
            raise SystemExit(tid + ': %d cells, which is at the limit; the table may be cut short' % cells)
        with open(os.path.join(RAW, tid + '.json'), 'wb') as f:
            f.write(raw)
        print('fetched', tid, len(d['row']), 'rows', cells, 'cells')
    for sec in MOM_TABLES:
        with open(os.path.join(RAW, 'MOM_LFR2025_Section%s.xlsx' % sec), 'wb') as f:
            f.write(get(MOM % sec))
        print('fetched MOM section', sec)


def num(v):
    try:
        return float(str(v).replace(',', ''))
    except (TypeError, ValueError):
        return 0.0          # '-' is nil or negligible, 'na' is not available


def table(tid):
    with open(os.path.join(RAW, tid + '.json'), encoding='utf-8') as f:
        return json.load(f)['Data']


def series(d):
    """Time series table -> {seriesNo: (label, latest value)}, and the latest period."""
    out, period = {}, None
    for r in d['row']:
        last = r['columns'][-1]
        out[r['seriesNo']] = (r['rowText'].strip(), num(last['value']))
        period = last['key']
    return out, period


def flat(cols, pre=''):
    out = {}
    for c in cols:
        key = (pre + '/' if pre else '') + c['key'].strip()
        if 'columns' in c:
            out.update(flat(c['columns'], key))
        else:
            out[key] = num(c.get('value'))
    return out


def band(label):
    """'25 - 29 Years', '20-24 Years', 'Employed Residents Aged 65 Years & Over' -> '25-29', '65+'."""
    t = label.replace('Employed Residents Aged', '').replace('Total Aged', '').replace('Years', '')
    t = t.replace(' ', '').replace('&Over', '+').replace('Below25', '<25')
    return t


def sheet(section, name):
    import openpyxl
    ws = openpyxl.load_workbook(os.path.join(RAW, 'MOM_LFR2025_Section%s.xlsx' % section), read_only=True)[name]
    rows = []
    for row in ws.iter_rows(values_only=True):
        cells = [c for c in row if c is not None and str(c).strip() != '']
        if cells:
            rows.append([str(c).replace('\n', ' ').strip() if isinstance(c, str) else c for c in cells])
    return rows


def deciles(total_by_band):
    """For each band, the share of it that falls in each national decile, assuming people are spread evenly
    within a band. Returns a list (one per band) of ten fractions."""
    total = sum(total_by_band)
    out, lo = [], 0.0
    for n in total_by_band:
        hi = lo + n / total
        frac = []
        for j in range(10):
            a, b = max(lo, j / 10), min(hi, (j + 1) / 10)
            frac.append(max(0.0, b - a) / (hi - lo) if hi > lo else 0.0)
        out.append(frac)
        lo = hi
    return out


def spread(counts_by_band, fracs):
    d = [0.0] * 10
    for n, frac in zip(counts_by_band, fracs):
        for j in range(10):
            d[j] += n * frac[j]
    s = sum(d) or 1
    return [round(x / s, 4) for x in d]


def build():
    sources = []

    def cite(tid, d, period, used):
        sources.append({'id': tid, 'title': d['title'], 'agency': (d.get('datasource') or d.get('dataSource') or '').title(),
                        'period': period, 'updated': d.get('dataLastUpdated'), 'url': API % tid, 'used_for': used})

    # ---- ethnicity by age, and the ages of the old (M810011) -----------
    d = table('M810011'); s, period = series(d); cite('M810011', d, 'end June ' + period, SINGSTAT['M810011'])
    heads = {'Total Malays': 'malay', 'Total Chinese': 'chinese', 'Total Indians': 'indian'}
    eth, age_all = {}, {}
    for no, (label, v) in s.items():
        if '.' not in no:
            continue
        head = s[no.split('.')[0]][0]
        b = band(label)
        if b not in ('20-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64',
                     '65-69', '70-74', '75-79', '80-84', '85-89', '90+'):
            continue
        if head == 'Total Residents':
            age_all[b] = v
        elif head in heads:
            eth.setdefault(b, {})[heads[head]] = v
    for b_, e in eth.items():
        if len(e) != 3:
            raise SystemExit('M810011: an ethnic group is missing for ages ' + b_)
        # the table publishes three groups and the total; everyone else is the remainder
        e['other'] = age_all[b_] - sum(e.values())
    elder_ages = {b: age_all[b] for b in ('65-69', '70-74', '75-79', '80-84', '85-89', '90+')}

    # ---- type of home by age (M810381) ---------------------------------
    d = table('M810381'); s, period = series(d); cite('M810381', d, 'end June ' + period, SINGSTAT['M810381'])
    leaf = {'1.1': 'hdb_1_2', '1.2': 'hdb_3', '1.3': 'hdb_4', '1.4': 'hdb_5', '2': 'condo', '3': 'landed'}
    dwelling = {}
    for no, (label, v) in s.items():
        head, _, rest = no.partition('.')
        if rest in leaf and head != '1':
            dwelling.setdefault(band(s[head][0]), {})[leaf[rest]] = v
    dwelling = {b: v for b, v in dwelling.items() if b in age_all}

    # ---- who people live with (M810891) --------------------------------
    d = table('M810891'); s, period = series(d); cite('M810891', d, period, SINGSTAT['M810891'])
    arrangement = {'1.1.1': 'multigenerational', '1.1.2': 'couple_with_children',
                   '1.2.1': 'couple_with_parents', '1.2.2': 'couple',
                   '2.1.1': 'multigenerational', '2.1.2': 'single_parent',
                   '2.2.1': 'with_parents', '2.2.2': 'with_others',
                   '3': 'lives_alone', '4': 'lives_alone'}
    household = {}
    for no, (label, v) in s.items():
        head, _, rest = no.partition('.')
        if head in ('2', '3', '4', '5', '6') and rest in arrangement:
            h = household.setdefault(band(s[head][0]), {})
            h[arrangement[rest]] = h.get(arrangement[rest], 0) + v

    # ---- number of children (M810571) ----------------------------------
    d = table('M810571'); s, period = series(d); cite('M810571', d, period, SINGSTAT['M810571'])
    children = {}
    for no, (label, v) in s.items():
        head, _, rest = no.partition('.')
        if not rest or label == 'None':
            continue
        n = min(4, int(label[0]))
        c = children.setdefault(band(s[head][0]), {})
        c[str(n)] = c.get(str(n), 0) + v

    # ---- workers' ages by industry (M182131) ---------------------------
    d = table('M182131'); s, period = series(d); cite('M182131', d, 'June ' + period, SINGSTAT['M182131'])
    by_ind = {}                                    # industry -> band -> thousands
    for no, (label, v) in s.items():
        head, _, rest = no.partition('.')
        if rest and head != '1':
            by_ind.setdefault(label, {})[band(s[head][0])] = v
    age_by_sector, elder_by_sector = {}, {}
    for k, inds in INDUSTRY.items():
        for i in inds:
            if i not in by_ind:
                raise SystemExit('M182131 has no industry called ' + i)
        age_by_sector[k] = {b: round(sum(by_ind[i][b] for i in inds), 1)
                            for b in ('20-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64')}
        elder_by_sector[k] = round(sum(by_ind[i]['65+'] for i in inds), 1)

    # ---- labour force status by age (MOM A4) ---------------------------
    rows = sheet('A', 'A4')
    a4 = {}
    for r in rows:
        if r[0] == 'Male':
            break
        label = r[1] if r[0] == 'Total' and len(r) > 5 else r[0]
        if isinstance(label, str) and len(r) >= 5 and all(isinstance(x, (int, float)) for x in r[-4:]):
            a4[label.replace(' ', '').replace('&Over', '+')] = dict(zip(('lf', 'employed', 'unemployed', 'outside'), r[-4:]))
    sources.append({'id': 'MOM A4', 'title': 'Resident population aged fifteen years and over by labour force status, age and sex, 2025',
                    'agency': 'Ministry Of Manpower, Labour Force in Singapore 2025', 'period': 'June 2025',
                    'url': MOM % 'A', 'used_for': MOM_TABLES['A'][1]})
    elder_work = {b: round(a4[b]['employed'] / (a4[b]['lf'] + a4[b]['outside']), 4) for b in ('65-69', '70+')}

    # ---- why working-age people are not working (MOM L7) ---------------
    rows = sheet('L', 'L7')
    cols = None
    reasons = {}
    for r in rows:
        if r[0] == 'Total' and '15 - 24' in r:
            cols = [str(c).replace(' ', '').replace('&Over', '+') for c in r]
            continue
        if cols is None:
            continue
        if r[0] == 'Male':
            break
        label = 'Total' if r[0] == 'Total' else r[0]
        vals = [num(x) for x in (r[2:] if r[0] == 'Total' else r[1:])]
        if label not in reasons:                    # the two rows under "care for own children" repeat its label
            reasons[label[:28]] = dict(zip(cols, vals))
    sources.append({'id': 'MOM L7', 'title': 'Residents outside the labour force aged fifteen years and over by main reason for not working, age and sex, 2025',
                    'agency': 'Ministry Of Manpower, Labour Force in Singapore 2025', 'period': 'June 2025',
                    'url': MOM % 'L', 'used_for': MOM_TABLES['L'][1]})
    STATUS = {'Education': 'student', 'Housework': 'carer', 'Care for Own': 'carer', 'Care for Fam': 'carer',
              'Retired': 'retired', 'Have Suffici': 'retired',
              'Poor Health ': 'not_working', 'Permanently ': 'not_working', 'Taking a Bre': 'not_working',
              'Discouraged': 'not_working', 'Others': 'not_working'}
    # the reasons table has wider age bands than the status table at both ends of working age
    REASON_COL = {'20-24': '15-24', '25-29': '25-29', '30-39': '30-39', '40-49': '40-49', '50-59': '50-59', '60-64': '60-69'}
    A4_BANDS = {'20-24': ['20-24'], '25-29': ['25-29'], '30-39': ['30-34', '35-39'], '40-49': ['40-44', '45-49'],
                '50-59': ['50-54', '55-59'], '60-64': ['60-64']}
    not_employed = {}
    for b, parts in A4_BANDS.items():
        outside = sum(a4[p]['outside'] for p in parts)
        col = REASON_COL[b]
        share = {}
        for label, v in reasons.items():
            if label == 'Total':
                continue
            st = next((s_ for key, s_ in STATUS.items() if label.startswith(key)), None)
            if st is None:
                raise SystemExit('L7: a reason has no status: ' + label)
            share[st] = share.get(st, 0) + v[col]
        tot = sum(share.values())
        for st, v in share.items():
            not_employed.setdefault(st, {})[b] = round(outside * v / tot, 2)
        not_employed.setdefault('unemployed', {})[b] = round(sum(a4[p]['unemployed'] for p in parts), 2)

    # ---- income position by industry (MOM C13) -------------------------
    rows = sheet('C', 'C13')
    head, bands_ = None, []
    for r in rows:
        if r[0] == 'Total' and any(isinstance(c, str) and 'Manufacturing' in c for c in r):
            head = r                      # the blank corner cell is dropped on reading, so this lines up with the values
            continue
        if head is None:
            continue
        if r[0] == 'Male':
            break
        if r[0] == 'Total' or str(r[0]).startswith('$20,000'):     # the total row; and a sub-row of "$12,000 & over"
            continue
        bands_.append((r[0], [num(x) for x in r[1:]]))
    names = [str(h) for h in head]

    def col_of(ind):
        hits = [i for i, n in enumerate(names) if ind.split(' ')[0] in n and (ind != 'Others' or n.endswith('Others'))]
        if ind == 'Others':
            hits = [i for i, n in enumerate(names) if n.endswith('Others')]
        if len(hits) != 1:
            raise SystemExit('C13: cannot find a single column for ' + ind + ': ' + str(hits))
        return hits[0]
    fr = deciles([v[0] for _, v in bands_])
    decile_by_sector = {}
    for k, inds in INDUSTRY.items():
        cs = [col_of(i) for i in inds]
        decile_by_sector[k] = spread([sum(v[c] for c in cs) for _, v in bands_], fr)
    sources.append({'id': 'MOM C13', 'title': 'Employed residents aged fifteen years and over by gross monthly income from employment (excluding employer CPF), industry and sex, 2025',
                    'agency': 'Ministry Of Manpower, Labour Force in Singapore 2025', 'period': 'June 2025',
                    'url': MOM % 'C', 'used_for': MOM_TABLES['C'][1]})

    # ---- income position by type of home (C020102) ---------------------
    d = table('C020102'); cite('C020102', d, 'General Household Survey 2025', SINGSTAT['C020102'])
    col = {'HDB Dwellings/HDB 1- & 2- Room Flats': 'hdb_1_2', 'HDB Dwellings/HDB 3-Room Flats': 'hdb_3',
           'HDB Dwellings/HDB 4-Room Flats': 'hdb_4', 'HDB Dwellings/HDB 5-Room & Executive Flats': 'hdb_5',
           'Condominium & Other Apartments': 'condo', 'Landed Properties': 'landed'}
    inc = []
    for r in d['row']:
        if r['rowText'].strip() == 'Total':
            continue
        f = flat(r['columns'])
        total = next(v for k_, v in f.items() if k_.startswith('Total'))
        inc.append((total, {name: next(v for k_, v in f.items() if k_.startswith(key)) for key, name in col.items()}))
    fr = deciles([t for t, _ in inc])
    decile_by_dwelling = {name: spread([v[name] for _, v in inc], fr) for name in DWELLINGS}

    # ---- region by type of home (C020125) ------------------------------
    d = table('C020125'); cite('C020125', d, 'General Household Survey 2025', SINGSTAT['C020125'])
    region_by_dwelling = {name: {r: 0.0 for r in REGION} for name in DWELLINGS}
    seen = 0
    for r in d['row']:
        t = r['rowText'].strip()
        if not t.endswith(' - Total'):
            continue
        area = t[:-8].strip().lower()
        if area not in AREA_REGION:
            raise SystemExit('C020125: planning area with no region: ' + t)
        seen += 1
        f = flat(r['columns'])
        for key, name in col.items():
            region_by_dwelling[name][AREA_REGION[area]] += next((v for k_, v in f.items() if k_.startswith(key)), 0.0)
    if seen != 55:
        raise SystemExit('C020125: expected 55 planning areas, found %d' % seen)

    # ---- health by age (C020175) ---------------------------------------
    d = table('C020175'); cite('C020175', d, 'General Household Survey 2025', SINGSTAT['C020175'])
    health = {}
    for r in d['row']:
        t = r['rowText'].strip()
        if t == 'Total':
            continue
        f = flat(r['columns'])
        pick = lambda words: next(v for k_, v in f.items() if all(w in k_ for w in words) and k_.endswith('/Total'))
        health[t.replace(' ', '').replace('&Over', '+').replace('Below25', '<25')] = {
            'good': pick(['No Difficulty']), 'fair': pick(['Some Difficulty']), 'poor': pick(['Unable to Perform'])}

    out = {
        'meta': {
            'built': datetime.date.today().isoformat(),
            'note': 'Compiled by data/singstat/build.py from the tables in data/singstat/raw. Do not edit by hand.',
            'sources': sources,
            'typed_in': ['planning area to region (URA Master Plan 2019 planning regions)',
                         'scenario industry to published industry (SSIC 2020 sections)'],
            'industry_of': INDUSTRY
        },
        'elder_ages': elder_ages,
        'elder_employment': elder_work,
        'elder_by_sector': elder_by_sector,
        'ethnicity_by_age': eth,
        'dwelling_by_age': dwelling,
        'household_by_age': household,
        'children_by_age': children,
        'age_by_sector': age_by_sector,
        'not_employed': not_employed,
        'decile_by_sector': decile_by_sector,
        'decile_by_dwelling': decile_by_dwelling,
        'region_by_dwelling': {k: {r: round(v) for r, v in t.items()} for k, t in region_by_dwelling.items()},
        'health_by_age': health,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1)
    print('wrote', os.path.normpath(OUT))
    return out


def write_sources(o):
    """The same list, for people: data/singstat/SOURCES.md."""
    m = o['meta']
    L = ['# Where the residents come from', '',
         'Written by `data/singstat/build.py` on ' + m['built'] + '. Do not edit by hand: run the script.', '',
         'Two layers, kept apart.', '',
         '- **The scenario** sets how many people there are: the size of each age band and the headcount of each',
         '  industry come from the engine. That is a brief about 2050, not a measurement.',
         '- **Published statistics** set who those people are. Every share comes from the tables below.',
         '  So the residents are present-day Singaporeans placed in the 2050 economy.', '',
         '## The tables', '',
         '| Table | Title | Agency | Period | Used for |', '|---|---|---|---|---|']
    for x in m['sources']:
        L.append('| [%s](%s) | %s | %s | %s | %s |' % (x['id'], x['url'], x['title'], x['agency'], x['period'], x['used_for']))
    L += ['', 'SingStat links are the Table Builder API addresses the script reads. The same table can be opened in a',
          'browser at tablebuilder.singstat.gov.sg by searching for its ID. Ministry of Manpower links are the',
          'workbooks of *Labour Force in Singapore 2025*; the sheet is the table number.', '',
          '## How each attribute is drawn', '',
          '| Attribute | Drawn from | Given |', '|---|---|---|',
          '| Age, workers 20 to 64 | M182131 | their industry |',
          '| Age, not working 20 to 64 | MOM A4 and L7 | why they are not working |',
          '| Age, 65 and over | M810011 | |',
          '| Why not working (studying, caring, retired early, not working, looking for work) | MOM A4 and L7 | |',
          '| Still working at 65 and over | MOM A4 | age 65 to 69, or 70 and over |',
          '| Industry of workers 65 and over | M182131 | |',
          '| Ethnicity | M810011 | age |',
          '| Type of home | M810381 | age |',
          '| Income position (tenth of the distribution) | C020102, and MOM C13 for workers | type of home; industry |',
          '| Region | C020125 | type of home |',
          '| Who they live with | M810891 | age |',
          '| Number of children | M810571 | age, if children are in the household and the person is under 65 |',
          '| Health | C020175 | age |', '',
          '## Typed in, not downloaded', '',
          '- **Planning area to region.** SingStat publishes residents by planning area. The five regions are the',
          '  planning regions of the URA Master Plan 2019. The list is in `build.py`.',
          '- **Scenario industry to published industry.** A judgement, in `build.py`:', '']
    for k, v in m['industry_of'].items():
        L.append('  - `%s` uses %s' % (k, ' and '.join(v)))
    L += ['', '  Four published industries have no counterpart in the scenario and are not used: professional services,',
          '  administrative and support services, arts and recreation, other community and personal services.', '',
          '## Assumptions made in joining the tables', '',
          '- The tables are published separately, not as one cross-tabulation. Each attribute is drawn given one',
          '  other (see above), so links that no table records are not reproduced. Ethnicity and type of home, for',
          '  example, are each right by age but are not linked to each other.',
          '- Income position is drawn from the table for the home and, for a worker, tilted by the table for the',
          '  industry, as if the two were independent once income is known.',
          '- Tables of households (C020102) are read as describing the people in them. Household income per member',
          '  and personal income from work are treated as one ranking.',
          '- People are spread evenly within a published band (an income band, an age band).',
          '- Health is difficulty with basic activities (none, some, a lot), which is what the General Household',
          '  Survey asks. It is not self-rated health.',
          '- The survey counts any child living in the household, grown or not. Nobody over 65 is given dependent',
          '  children; for people aged 50 to 64 some counted children will be adults.',
          '- The reasons table has wider age bands than the status table at each end of working age: reasons for',
          '  ages 15 to 24 are applied to 20 to 24, and reasons for 60 to 69 to 60 to 64.',
          '- The published 2025 and 2026 shares are used unchanged for a scenario set in 2050.', '',
          '## Not from any official table', '',
          '- Months of savings and ability to leave the country: formulas on income and age, in `agents/population.js`.',
          '- Temperament: five traits, each equally likely from 1 to 5, independent of everything else. No',
          '  representative Big Five survey of Singapore residents was found.',
          '- Names: short lists by ethnic group.',
          '- Sex is not modelled.', '',
          '## Rebuilding', '',
          '    python data/singstat/build.py --fetch', '',
          'downloads the tables again into `data/singstat/raw` and rewrites `agents/population-data.json` and this',
          'file. The API cuts a large table short without saying so; the script asks each time series for its',
          'latest period only and stops if a table comes back at the limit.', '']
    with open(os.path.join(HERE, 'SOURCES.md'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(L))
    print('wrote', os.path.join('data', 'singstat', 'SOURCES.md'))


if __name__ == '__main__':
    if '--fetch' in sys.argv:
        fetch()
    o = build()
    write_sources(o)
    tot = lambda t: sum(t.values())
    pc = lambda t: {k: round(100 * v / tot(t), 1) for k, v in t.items()}
    allages = lambda tb: {k: sum(b.get(k, 0) for b in tb.values()) for k in next(iter(tb.values()))}
    print('ethnicity, adults      ', pc(allages(o['ethnicity_by_age'])))
    print('home, adults           ', pc(allages(o['dwelling_by_age'])))
    print('region, all homes      ', pc({r: sum(o['region_by_dwelling'][d][r] for d in DWELLINGS) for r in REGION}))
    print('not employed, 20-64    ', pc({s: tot(v) for s, v in o['not_employed'].items()}))
    print('still working at 65+   ', o['elder_employment'])
    print('health                 ', {b: pc(v) for b, v in o['health_by_age'].items()})
    print('household, 35-49       ', pc(o['household_by_age']['35-49']))
    print('household, 65+         ', pc(o['household_by_age']['65+']))
    print('income decile, finance ', o['decile_by_sector']['finance'])
    print('income decile, food    ', o['decile_by_sector']['food_agri'])
    print('income decile, 1-2 room', o['decile_by_dwelling']['hdb_1_2'])
    print('income decile, landed  ', o['decile_by_dwelling']['landed'])

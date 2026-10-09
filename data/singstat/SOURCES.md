# Where the residents come from

Written by `data/singstat/build.py` on 2026-10-06. Do not edit by hand: run the script.

Two layers, kept apart.

- **The scenario** sets how many people there are: the size of each age band and the headcount of each
  industry come from the engine. That is a brief about 2050, not a measurement.
- **Published statistics** set who those people are. Every share comes from the tables below.
  So the residents are present-day Singaporeans placed in the 2050 economy.

## The tables

| Table | Title | Agency | Period | Used for |
|---|---|---|---|---|
| [M810011](https://tablebuilder.singstat.gov.sg/api/table/tabledata/M810011?limit=5000) | Singapore Residents By Age Group, Ethnic Group And Sex, At End June, Annual | Singapore Department Of Statistics | end June 2026 | ethnicity by age; ages of people 65 and over |
| [M810381](https://tablebuilder.singstat.gov.sg/api/table/tabledata/M810381?limit=5000) | Singapore Residents By Age Group And Type Of Dwelling, Annual | Singapore Department Of Statistics | end June 2026 | type of home by age |
| [M810891](https://tablebuilder.singstat.gov.sg/api/table/tabledata/M810891?limit=5000) | Residents In Resident Households By Living Arrangement, Age Group And Sex, Annual | Singapore Department Of Statistics | 2025 | who people live with, by age |
| [M810571](https://tablebuilder.singstat.gov.sg/api/table/tabledata/M810571?limit=5000) | Resident Ever-Married Females By Age Group And Number Of Children Born, Annual | Singapore Department Of Statistics | 2025 | number of children |
| [M182131](https://tablebuilder.singstat.gov.sg/api/table/tabledata/M182131?limit=5000) | Employed Residents Aged 15 Years And Over By Industry And Age Group, (June), Annual | Ministry Of Manpower | June 2025 | ages of workers in each industry; which industries older workers are in |
| [MOM A4](https://stats.mom.gov.sg/iMAS_Tables1/LabourForce/LabourForce_2025/LFR2025_SectionA.xlsx) | Resident population aged fifteen years and over by labour force status, age and sex, 2025 | Ministry Of Manpower, Labour Force in Singapore 2025 | June 2025 | share of people 65 and over still working; unemployed and outside the labour force by age |
| [MOM L7](https://stats.mom.gov.sg/iMAS_Tables1/LabourForce/LabourForce_2025/LFR2025_SectionL.xlsx) | Residents outside the labour force aged fifteen years and over by main reason for not working, age and sex, 2025 | Ministry Of Manpower, Labour Force in Singapore 2025 | June 2025 | why working-age people are not working: studying, caring, retired early, other |
| [MOM C13](https://stats.mom.gov.sg/iMAS_Tables1/LabourForce/LabourForce_2025/LFR2025_SectionC.xlsx) | Employed residents aged fifteen years and over by gross monthly income from employment (excluding employer CPF), industry and sex, 2025 | Ministry Of Manpower, Labour Force in Singapore 2025 | June 2025 | income position by industry |
| [C020102](https://tablebuilder.singstat.gov.sg/api/table/tabledata/C020102?limit=5000) | Resident Households by Monthly Household Market Income Per Household Member and Type of Dwelling | Singapore Department Of Statistics | General Household Survey 2025 | income position by type of home |
| [C020125](https://tablebuilder.singstat.gov.sg/api/table/tabledata/C020125?limit=5000) | Resident Population by Planning Area/Subzone of Residence and Type of Dwelling | Singapore Department Of Statistics | General Household Survey 2025 | region by type of home |
| [C020175](https://tablebuilder.singstat.gov.sg/api/table/tabledata/C020175?limit=5000) | Resident Population Aged 5 Years and Over by Age Group, Level of Difficulty in Performing Basic Activities and Sex | Singapore Department Of Statistics | General Household Survey 2025 | health by age |

SingStat links are the Table Builder API addresses the script reads. The same table can be opened in a
browser at tablebuilder.singstat.gov.sg by searching for its ID. Ministry of Manpower links are the
workbooks of *Labour Force in Singapore 2025*; the sheet is the table number.

## How each attribute is drawn

| Attribute | Drawn from | Given |
|---|---|---|
| Age, workers 20 to 64 | M182131 | their industry |
| Age, not working 20 to 64 | MOM A4 and L7 | why they are not working |
| Age, 65 and over | M810011 | |
| Why not working (studying, caring, retired early, not working, looking for work) | MOM A4 and L7 | |
| Still working at 65 and over | MOM A4 | age 65 to 69, or 70 and over |
| Industry of workers 65 and over | M182131 | |
| Ethnicity | M810011 | age |
| Type of home | M810381 | age |
| Income position (tenth of the distribution) | C020102, and MOM C13 for workers | type of home; industry |
| Region | C020125 | type of home |
| Who they live with | M810891 | age |
| Number of children | M810571 | age, if children are in the household and the person is under 65 |
| Health | C020175 | age |

## Typed in, not downloaded

- **Planning area to region.** SingStat publishes residents by planning area. The five regions are the
  planning regions of the URA Master Plan 2019. The list is in `build.py`.
- **Scenario industry to published industry.** A judgement, in `build.py`:

  - `healthcare` uses Health & Social Services
  - `care_services` uses Health & Social Services
  - `education_research` uses Public Administration & Education
  - `transport_logistics` uses Transportation & Storage
  - `energy_utilities` uses Others
  - `compute_telecom` uses Information & Communications
  - `housing_construction` uses Construction and Real Estate Services
  - `food_agri` uses Accommodation & Food Services
  - `manufacturing` uses Manufacturing
  - `finance` uses Financial & Insurance Services
  - `retail_commerce` uses Wholesale & Retail Trade
  - `public_admin` uses Public Administration & Education
  - `public_safety` uses Public Administration & Education

  Four published industries have no counterpart in the scenario and are not used: professional services,
  administrative and support services, arts and recreation, other community and personal services.

## Assumptions made in joining the tables

- The tables are published separately, not as one cross-tabulation. Each attribute is drawn given one
  other (see above), so links that no table records are not reproduced. Ethnicity and type of home, for
  example, are each right by age but are not linked to each other.
- Income position is drawn from the table for the home and, for a worker, tilted by the table for the
  industry, as if the two were independent once income is known.
- Tables of households (C020102) are read as describing the people in them. Household income per member
  and personal income from work are treated as one ranking.
- People are spread evenly within a published band (an income band, an age band).
- Health is difficulty with basic activities (none, some, a lot), which is what the General Household
  Survey asks. It is not self-rated health.
- The survey counts any child living in the household, grown or not. Nobody over 65 is given dependent
  children; for people aged 50 to 64 some counted children will be adults.
- The reasons table has wider age bands than the status table at each end of working age: reasons for
  ages 15 to 24 are applied to 20 to 24, and reasons for 60 to 69 to 60 to 64.
- The published 2025 and 2026 shares are used unchanged for a scenario set in 2050.

## Not from any official table

- Months of savings and ability to leave the country: formulas on income and age, in `agents/population.js`.
- Temperament: five traits, each equally likely from 1 to 5, independent of everything else. No
  representative Big Five survey of Singapore residents was found.
- Names: short lists by ethnic group.
- Sex is not modelled.

## Rebuilding

    python data/singstat/build.py --fetch

downloads the tables again into `data/singstat/raw` and rewrites `agents/population-data.json` and this
file. The API cuts a large table short without saying so; the script asks each time series for its
latest period only and stops if a table comes back at the limit.

export function getVehicleColorForAgency(
  routeShortName: string | null | undefined,
  agencyName?: string | null
): string {
  if (!agencyName) {
    return '#424242';
  }

  const agencyKey = agencyName.toLowerCase();
  const routeKey = routeShortName || '';

  const routeColorMap: Record<string, Record<string, string>> = {
    'san francisco municipal transportation agency': {
      J: '#DF8719',
      K: '#579BBE',
      KBUS: '#579BBE',
      L: '#942593',
      LBUS: '#942593',
      LOWL: '#942593',
      M: '#03814E',
      N: '#084E75',
      NBUS: '#084E75',
      NOWL: '#084E75',
      T: '#D01245',
      TBUS: '#D01245',
      F: '#6D4300',
      FBUS: '#6D4300',
      PM: '#911515',
      PH: '#911515',
      CA: '#911515'
    },
    'ac transit': {
      '1T': '#6B1984'
    },
    vta: {
      'Blue Line': '#2CB6E7',
      'Green Line': '#A1CF67',
      'Orange Line': '#F89923',
      OrangeW: '#F89923',
      OrangeE: '#F89923',
      GreenS: '#A1CF67',
      BlueS: '#2CB6E7'
    },
    soltrans: {
      R: '#D63029',
      Y: '#FDB415',
      G: '#50A140',
      B: '#004D91'
    },
    'san diego mts': {
      'Blue Line': '#0070BF',
      'Green Line': '#32BB6A',
      'Orange Line': '#FFA532',
      Copper: '#C0835B'
    },
    'la metro': {
      'A Line': '#0073BD',
      'B Line': '#E40B14',
      'C Line': '#57A935',
      'D Line': '#A25DA7',
      'E Line': '#F7B710',
      'G Line': '#FC4B00',
      'J Line': '#AEB9C0',
      'K Line': '#EA6BB2'
    },
    'sound transit': {
      '1 Line': '#3DAE2B',
      '2 Line': '#00A0DF',
      'T Line': '#F38B00',
      'ST Express': '#2B376E'
    }
  };

  const agencyColorMap: Record<string, string> = {
    //SF
    'san francisco municipal transportation agency': '#CD3545',
    samtrans: '#00529B',
    'golden gate ferry': '#426C3E',
    'golden gate transit': '#426C3E',
    caltrain: '#DB1734',
    'ac transit': '#006B54',
    'san francisco bay ferry': '#0A4E86',
    'san francisco bay ferries': '#0A4E86',
    'county connection': '#FFB944',
    'livermore amador valley transit authority': '#02354C',
    'dumbarton express consortium': '#007AFF',
    vta: '#4CB4E7',
    soltrans: '#2C8736',
    'vine transit': '#E77342',
    'sonoma county transit': '#193888',
    santarosa: '#035B91',
    'sonoma-marin area rail transit': '#104432',
    'tri delta transit': '#004B8F',
    fast: '#064F8F',
    'emery go-round': '#FFA801',
    'presidio go': '#1F4D25',
    'marin transit': '#3DAE2B',
    petaluma: '#3C5D9E',
    'westcat (western contra costa)': '#0057A5',
    sonoma: '#193888',
    'sfo airport': '#009ADE',
    mvgo: '#7CC144',
    'capitol corridor joint powers authority': '#00537E',
    'altamont corridor express': '#78217D',
    'vacaville city coach': '#19A1DB',
    'union city transit': '#141972',
    //SoCal
    'san diego mts': '#DE2B26',
    'north county transit district': '#088C99',
    'la metro': '#262626',
    ladot: '#0D47A1',
    'long beach transit': '#D62028',
    'foothill transit': '#1A87BC',
    'pasadena transit': '#1BA6BC',
    //Seattle (Sound Transit)
    'sound transit': '#2B376E'
  };

  const routeMap = routeColorMap[agencyKey];
  if (routeMap && routeKey && routeMap[routeKey]) {
    return routeMap[routeKey];
  }

  if (agencyKey === 'vta' && routeKey.includes('Rapid')) {
    return '#E4002B';
  }

  return agencyColorMap[agencyKey] || '#424242';
}

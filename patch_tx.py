import pandas as pd
import json
import sys

excel_path = r'C:\Users\luisb\Downloads\Trucky_Rates_Drayage_TX_v3.xlsx'
json_path = 'base44/functions/marketChat/data/routes.tx.json'

try:
    df = pd.read_excel(excel_path, skiprows=1)
except Exception as e:
    print(f"Error reading excel: {e}")
    sys.exit(1)

with open(json_path, 'r', encoding='utf-8') as f:
    routes = json.load(f)

# df columns: Mercado, Zona, Ciudad destino, Millas (ida), Piso 20', Objetivo 20', Piso 40', Objetivo 40'
for route in routes:
    ciudad = route['ciudad']
    mercado = route['mercado']
    
    # find row in excel
    row = df[(df.iloc[:, 0].astype(str) == mercado) & (df.iloc[:, 2].astype(str) == ciudad)]
    if not row.empty:
        millas = row.iloc[0, 3]
        piso_40 = row.iloc[0, 6]
        obj_40 = row.iloc[0, 7]
        
        # Some rows might have empty values
        try:
            route['millas_ida'] = int(millas)
        except:
            pass
            
        try:
            route['precios'][0]['piso_tabla'] = int(piso_40)
        except:
            pass
            
        try:
            route['precios'][0]['objetivo'] = int(obj_40)
        except:
            pass

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(routes, f, indent=2)

print("routes.tx.json patched successfully!")

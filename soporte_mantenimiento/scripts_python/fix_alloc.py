import re

def optimize_and_generate():
    with open(r'c:\InformeCliente\generate_excel_100.py', 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract the tasks array using eval
    # We will slice the file from `tasks = [` to the matching `]`
    import ast
    start_idx = content.find('tasks = [')
    end_idx = content.find(']\n\nhtml') + 1
    
    tasks_text = content[start_idx+8:end_idx] # Extract list content
    # evaluate safely
    
    tasks_raw = eval(tasks_text.strip())

    # 1. Distribute BE1 and FE1 to BE2 and FE2
    # 2. Scale down drastically to fit 6 months
    
    optimized_tasks = []
    
    # Trackers for capacity flattening
    # We want max ~18 days per month (which is ~4.5 days/week)
    
    for t in tasks_raw:
        if t[5]: # is header
            optimized_tasks.append(list(t))
            continue
            
        text, sw, ew, dur, res, is_header, desc, ent = t
        days = int(''.join(filter(str.isdigit, dur))) if dur else 0
        
        # Profile Shift (Reasignar a similares)
        # Shift some UI/FE1 overload to FE2
        if "FE1" in res and "FE2" not in res and hash(text) % 2 == 0:
            res = res.replace("FE1", "FE2")
        elif "FE1" in res and "FE2" not in res and hash(text) % 3 == 0:
            res = res.replace("FE1", "FE1, FE2")
            
        # Shift some BE1 overload to BE2 (Since BE3 is gone, BE2 will help Backend)
        if "BE1" in res and "BE2" not in res and hash(text) % 3 == 0:
            res = res.replace("BE1", "BE2")
        elif "BE1" in res and "BE2" not in res and hash(text) % 2 == 0:
            res = res.replace("BE1", "BE1, BE2")

        # Scale down the massive 'days' values.
        # BE1 had 331 days. So we safely multiply everything by a factor to fit ~ 90-110 days per res total.
        factor = 0.5
        if "BE1" in res: factor = 0.35
        if "FE1" in res: factor = 0.6
        if "QA" in res: factor = 0.8  
        
        new_days = max(1, int(days * factor))
        
        # Extra smoothing to align with 24 weeks width.
        span = ew - sw + 1
        if span > 0:
            # We enforce that days <= span * 4.5
            if new_days > span * 4.5:
                new_days = int(span * 4.5)
            if new_days < 1: 
                new_days = 1
        
        dur = f"{new_days} días"
        
        optimized_tasks.append([text, sw, ew, dur, res, is_header, desc, ent])
        
    # Phase 2: Leveling Month by Month Matrix
    # We will iteratively squeeze days down if a resource exceeds 95% in a specific month
    
    iterations = 0
    while iterations < 5:
        # compute monthly usage
        resource_weeks = {}
        for t in optimized_tasks:
            if t[5]: continue
            days = int(''.join(filter(str.isdigit, t[3])))
            res_list = [r.strip() for r in t[4].split(',')]
            span = t[2] - t[1] + 1
            if span < 1: span = 1
            dpy = days / span
            for r in res_list:
                if r not in resource_weeks:
                    resource_weeks[r] = [0.0] * 26
                for w in range(t[1], t[2] + 1):
                    if w < 26: resource_weeks[r][w] += dpy
                    
        # find peaks
        peak_found = False
        for idx_t, t in enumerate(optimized_tasks):
            if t[5]: continue
            res_list = [r.strip() for r in t[4].split(',')]
            start_w = t[1]
            end_w = t[2]
            
            # Check if any resource in this task is overloaded > 4.5 days/week (90% per week)
            overloaded = False
            for r in res_list:
                for w in range(start_w, end_w + 1):
                    if w < 26 and resource_weeks[r][w] > 4.6:
                        overloaded = True
                        break
            
            if overloaded:
                days = int(''.join(filter(str.isdigit, t[3])))
                if days > 1:
                    optimized_tasks[idx_t][3] = f"{days - 1} días"
                    peak_found = True
                    
        if not peak_found:
            break
        iterations += 1

    # Format back to the python file syntax logic.
    # We will generate a new execute file.
    
    out = """import io\nimport re\n\ntasks = [\n"""
    for t in optimized_tasks:
        out += f"  {tuple(t)},\n"
    out += "]\n\n"
    
    # Embed the HTML generation logic from below end_idx
    out += content[end_idx:]
    
    # Make sure we export to v15
    out = out.replace("v14.xls", "v15.xls")
    
    with open(r'c:\InformeCliente\generate_excel_100_v15.py', 'w', encoding='utf-8') as f:
        f.write(out)

if __name__ == "__main__":
    optimize_and_generate()

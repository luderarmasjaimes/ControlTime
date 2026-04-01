filepath = r'C:\InformeCliente\frontend\src\components\ReportStudioV2\components\document\PageCanvas.jsx'

with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Total lines before: {len(lines)}")

# Find the block to replace
start_idx = None
end_idx = None

for i, line in enumerate(lines):
    if 'runQuickCorrection();' in line and start_idx is None:
        for j in range(i, max(0, i-10), -1):
            if '<button' in lines[j] and start_idx is None:
                start_idx = j
                break

for i in range(start_idx or 0, min(len(lines), (start_idx or 0) + 60)):
    if end_idx is None and ('Mejorar Redacci' in lines[i]) and '</span>' in lines[i]:
        for j in range(i, min(len(lines), i+5)):
            if '</button>' in lines[j]:
                end_idx = j + 1
                break

print(f"Replacing lines {start_idx+1} to {end_idx}")

indent = '                            '
new_block = []

# Button 1: Quick correction (Corregir)
new_block.extend([
    indent + '<button\n',
    indent + '  type="button"\n',
    indent + '  className="btn-editor"\n',
    indent + '  title="Correcci\u00f3n ortogr\u00e1fica r\u00e1pida"\n',
    indent + '  onClick={(event) => {\n',
    indent + '    event.preventDefault();\n',
    indent + '    event.stopPropagation();\n',
    indent + '    runQuickCorrection();\n',
    indent + '  }}\n',
    indent + '>\n',
    indent + '  <CheckCheck size={14} />\n',
    indent + '  <span>Corregir</span>\n',
    indent + '</button>\n',
    '\n',
])

# Button 2: Advanced correction
new_block.extend([
    indent + '<button\n',
    indent + "  type=\"button\"\n",
    indent + "  className={`btn-editor ${isAnalyzingSpelling ? 'loading' : ''}`}\n",
    indent + '  disabled={isAnalyzingSpelling}\n',
    indent + '  title="Correcci\u00f3n ortogr\u00e1fica/gramatical avanzada (LanguageTool)"\n',
    indent + '  onClick={(event) => {\n',
    indent + '    event.preventDefault();\n',
    indent + '    event.stopPropagation();\n',
    indent + '    runAdvancedCorrection();\n',
    indent + '  }}\n',
    indent + '>\n',
    indent + '  {isAnalyzingSpelling ? <Sparkles size={14} className="animate-spin" /> : <SpellCheck2 size={14} />}\n',
    indent + '  <span>Avanzada</span>\n',
    indent + '</button>\n',
    '\n',
])

# Button 3: AI improvement
new_block.extend([
    indent + '<button\n',
    indent + "  type=\"button\"\n",
    indent + "  className={`btn-editor btn-ai ${isImproving ? 'loading' : ''}`}\n",
    indent + '  disabled={isImproving}\n',
    indent + '  title="Mejorar redacci\u00f3n con IA - transforma lenguaje cotidiano a t\u00e9cnico minero"\n',
    indent + '  onClick={(event) => {\n',
    indent + '    event.preventDefault();\n',
    indent + '    event.stopPropagation();\n',
    indent + '    runAIImprovement(textProps.text, updateTextProps);\n',
    indent + '  }}\n',
    indent + '>\n',
    indent + '  {isImproving ? <Sparkles size={14} className="animate-spin" /> : <Wand2 size={14} />}\n',
    indent + '  <span>Mejorar (IA)</span>\n',
    indent + '</button>\n',
])

lines[start_idx:end_idx] = new_block

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f"Total lines after: {len(lines)}")
print("Done!")

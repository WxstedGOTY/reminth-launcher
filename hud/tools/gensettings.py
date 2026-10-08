"""
Moves the game-setting cards out of Features2.settings() into hud/panel/settings.txt (one card per line), and writes a
Settings.java per compat family with exactly the cards that version of Minecraft has (checked with javap against that
version's own Options class: the method must exist with the right OptionInstance<type>, and any enum it uses must exist).
Run again after editing settings.txt.
"""
import os, re, subprocess, glob, json, sys
REPO=__import__('os').path.abspath(__import__('os').path.join(__import__('os').path.dirname(__file__), '..', '..'))
os.chdir(REPO)
P='hud/panel/java/com/wxsted/reminthhud/client/panel/'
MASTER='hud/panel/settings.txt'

def load(p):
    s=open(p,encoding='utf-8',newline='').read(); nl='\r\n' if '\r\n' in s else '\n'
    return s.replace('\r\n','\n'), nl

# 1) one-time: pull the lines out of Features2.settings()
f2,nl2=load(P+'Features2.java')
if not os.path.exists(MASTER):
    m=re.search(r'\tstatic List<Module> settings\(\) \{\n(.*?)\n\t\treturn l;\n\t\}\n', f2, re.S)
    body=m.group(1).split('\n')
    lines=[]
    for ln in body:
        t=ln.strip()
        if t.startswith('l.add(') or t.startswith('if (has('): lines.append(t)
        elif t.startswith('//') and not t.startswith('// 26.3'): lines.append(t)
    lines=[re.sub(r'^if \(has\("rawMouseInput"\)\) ','',x).replace('o -> option(o, "rawMouseInput")','o -> o.rawMouseInput()') for x in lines]
    lines=[x.replace('o -> o.invertMouseY()','o -> o.invertMouseY()|invertYMouse()') for x in lines]
    imports=[x for x in re.findall(r'^import (net\.minecraft\.[\w.]+);$', f2, re.M)]
    hdr=['# The game-setting cards of the Reminth panel, one per line (Java). Settings.java per Minecraft version is made',
         '# from this by tools/gensettings.py: a card is left out where that version has no such setting.',
         '# "o -> o.a()|b()" = the setting is called a() or, on older versions, b().',
         '# imports: ' + ' '.join(i for i in imports)]
    open(MASTER,'w',encoding='utf-8',newline='\n').write('\n'.join(hdr+lines)+'\n')
    # Features2.settings() now just asks the version's Settings
    f2=f2.replace(m.group(0),'\tstatic List<Module> settings() {\n\t\treturn Settings.all();\n\t}\n')
    # drop helpers has()/option() and the imports only the settings used
    f2=re.sub(r'\n\t/\*\* Whether this Minecraft has the game setting `name` \(Options\.name\(\)\)\. \*/\n\tstatic boolean has\(String name\) \{.*?\n\t\}\n','\n',f2,flags=re.S)
    f2=re.sub(r'\n\t/\*\* The game setting `name`, found by name.*?\n\t\}\n','\n',f2,flags=re.S)
    open(P+'Features2.java','w',encoding='utf-8',newline='').write(f2.replace('\n',nl2))

master=[l.rstrip('\n') for l in open(MASTER,encoding='utf-8')]
imports=next(l for l in master if l.startswith('# imports: '))[len('# imports: '):].split()
simple={i.split('.')[-1]:i for i in imports}
# nested: MusicManager.MusicFrequency
cards=[l for l in master if l.startswith('l.add(')]

FAMS={
 # dir: (versions to check, jars kind)
 'hud/compat/A': ['26.2'], 'hud/compat/B': ['26.3'], 'hud/compat/C': ['26.1'],
 'hud-1.21/compat/E': ['1.20.1'], 'hud-1.21/compat/A': ['1.21.1'], 'hud-1.21/compat/F': ['1.21.4','1.21.5'],
 'hud-1.21/compat/B': ['1.21.8'], 'hud-1.21/compat/C': ['1.21.10'], 'hud-1.21/compat/D': ['1.21.11'],
}

def cp(v):
    if v.startswith('26'):
        d=os.path.expanduser('~/.gradle/caches/fabric-loom/'+v)
        return ';'.join([d+'/minecraft-client.jar', d+'/minecraft-common.jar'])
    out=subprocess.run(['bash','-c','. /tmp/mcj.sh; mcw '+v],capture_output=True,text=True).stdout.strip()
    return out

cache={}
def members(v, cls):
    k=(v,cls)
    if k not in cache:
        r=subprocess.run(['javap','-cp',cp(v),cls],capture_output=True,text=True)
        cache[k]=r.stdout if r.returncode==0 else None
    return cache[k]

TYPE={'bool':'java.lang.Boolean','percent':'java.lang.Double','number':'java.lang.Double','integer':'java.lang.Integer'}
def card_ok(card, v):
    kind=re.match(r'(?:// )?l\.add\(OptionFeature\.(\w+)\(',card).group(1)
    m=re.search(r'o -> o\.([\w|()]+)',card)
    names=[n.replace('()','') for n in m.group(1).split('|')]
    opts=members(v,'net.minecraft.client.Options')
    chosen=None
    for n in names:
        mm=re.search(r'public net\.minecraft\.client\.OptionInstance<([\w.$]+)> '+n+r'\(\);', opts)
        if mm and (kind=='choice' or mm.group(1)==TYPE[kind]): chosen=n; break
    if not chosen: return None
    for e in re.findall(r'([A-Z]\w*(?:\.[A-Z]\w*)?)\.values\(\)',card):
        outer=e.split('.')[0]
        if outer not in simple: return None
        fq=simple[outer]+('$'+e.split('.')[1] if '.' in e else '')
        if members(v,fq) is None: return None
    return re.sub(r'o -> o\.[\w|()]+', 'o -> o.'+chosen+'()', card)

for fam,vers in FAMS.items():
    keep=[]
    for c in cards:
        res=[card_ok(c,v) for v in vers]
        if all(res) and len(set(res))==1: keep.append(res[0])
    used=set()
    for k in keep:
        for e in re.findall(r'([A-Z]\w*)(?:\.[A-Z]\w*)?\.values\(\)',k): used.add(simple[e])
    imps='\n'.join('import %s;'%u for u in sorted(used))
    fname=fam.split('/')[-1]
    src='''package com.wxsted.reminthhud.client.panel;

import java.util.ArrayList;
import java.util.List;

%s

/**
 * The game's own settings as panel cards, for this Minecraft version (compat family %s: %s). MADE BY
 * hud/tools/gensettings.py from hud/panel/settings.txt - edit that file, not this one: a card is left out where this
 * version has no such setting (%d of %d here).
 */
final class Settings {
	private Settings() {
	}

	static List<Module> all() {
		List<Module> l = new ArrayList<>();
		Module.Cat V = Module.Cat.VISUAL, P = Module.Cat.PERFORMANCE, C = Module.Cat.CHAT, M = Module.Cat.MECHANIC, U = Module.Cat.UTILITY;
%s
		return l;
	}
}
''' % (imps, fname, ' and '.join(vers), len(keep), len(cards), '\n'.join('\t\t'+k for k in keep))
    d=fam+'/client/java/com/wxsted/reminthhud/client/panel'
    os.makedirs(d,exist_ok=True)
    open(d+'/Settings.java','w',encoding='utf-8',newline='\n').write(src)
    missing=[re.search(r'"(\w+)"',c).group(1) for c in cards if not any(re.search(r'"(\w+)"',k).group(1)==re.search(r'"(\w+)"',c).group(1) for k in keep)]
    print(f'{fam:20} {"+".join(vers):16} {len(keep):3}/{len(cards)}  missing: {", ".join(missing)}')

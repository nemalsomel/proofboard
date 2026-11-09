import { describe, expect, it } from 'vitest';
import { mdToHtml } from '../../src/ui/agentpanel';

describe('agent válaszai: markdown', () => {
  it('táblázat (a modell válaszából), igazítás, cellán belüli formázás', () => {
    const src = '**Kapcsolás**\n\n| Honnan | Hová |\n|---|---|\n| Akku + (kapcsolón át) | DRV8833 **VM** és SuperMini **5V** láb |\n| SuperMini **GPIO4** (PWM) | DRV8833 **IN1** |\n\n- **Előre:** IN1 = PWM';
    const h = mdToHtml(src);
    expect(h).toContain('<table class="ag-table"><thead><tr><th>Honnan</th><th>Hová</th></tr></thead>');
    expect(h).toContain('<td>Akku + (kapcsolón át)</td><td>DRV8833 <b>VM</b> és SuperMini <b>5V</b> láb</td>');
    expect((h.match(/<tr>/g) || []).length).toBe(3);
    expect(h).toContain('<li><b>Előre:</b> IN1 = PWM</li>');
    expect(h).not.toContain('|---');
    expect(mdToHtml('a | b\n:-- | --:\n1 | 2')).toContain('<td style="text-align:right">2</td>');
    expect(mdToHtml('| a | b |\n|---|---|\n| csak egy |')).toContain('<td>csak egy</td><td></td>'); // hiányzó cella
  });
  it('nem táblázat: egyedül álló | jel marad szöveg; vízszintes vonal; kódblokk; biztonság', () => {
    expect(mdToHtml('A | B kapcsoló')).toBe('<p>A | B kapcsoló</p>');
    expect(mdToHtml('egy\n\n---\n\nkettő')).toBe('<p>egy</p><hr><p>kettő</p>');
    expect(mdToHtml('```py\nx = 1\n```')).toBe('<pre><code>x = 1</code></pre>');
    expect(mdToHtml('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(mdToHtml('| <b>x</b> | y |\n|---|---|\n| 1 | 2 |')).toContain('<th>&lt;b&gt;x&lt;/b&gt;</th>');
  });
});

import urllib.request
import urllib.parse
from html.parser import HTMLParser

class DDGParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_a = False
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            attrs = dict(attrs)
            if 'class' in attrs and 'result-snippet' in attrs['class']:
                self.links.append(attrs['href'])

def search(query):
    url = 'https://html.duckduckgo.com/html/'
    data = urllib.parse.urlencode({'q': query}).encode('utf-8')
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        html = urllib.request.urlopen(req).read().decode('utf-8')
        print(f"HTML Length: {len(html)}")
        import re
        links = set(re.findall(r'href="(https?://[^"]+)"', html))
        found = False
        for link in links:
            if "duckduckgo.com" not in link and "yahoo.com" not in link:
                print(link)
                found = True
        if not found:
            print(f"No external links found for query {query}")

    except Exception as e:
        print(f"Error: {e}")

search('software-mansion "radon-ide" "SimulatorKit"')
search('"software mansion" "SimDeviceLegacyHIDClient"')
search('"SimulatorKit" "rust"')

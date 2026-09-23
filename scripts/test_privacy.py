import gzip
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from privacy import process_file, sanitize_bytes, sanitize_text


class PrivacyTests(unittest.TestCase):
    def test_paths_and_json_remain_valid(self):
        home = '/' + '/'.join(['data01', 'home', 'example-person'])
        windows = 'C:' + '\\Users\\Example Person'
        original = {'posix': home + '/project/index.js', 'windows': windows + '\\project\\index.js'}
        clean = json.loads(sanitize_text(json.dumps(original)))
        self.assertEqual(clean, {'posix': '~/project/index.js', 'windows': '~\\project\\index.js'})
        self.assertEqual(sanitize_text('https://example.com/a /tmp/fixture.js ~/project'),
                         'https://example.com/a /tmp/fixture.js ~/project')
        url = 'https://example.com/' + 'home/example/profile'
        self.assertEqual(sanitize_text(url), url)
        self.assertEqual(sanitize_text('https://example.com/root/path'), 'https://example.com/root/path')

    def test_plain_check_write_and_idempotence(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'sample.json'
            data = json.dumps({'path': '/' + 'home/example-person/source', 'time': 1.25}).encode()
            file.write_bytes(data)
            self.assertTrue(process_file(file))
            self.assertEqual(file.read_bytes(), data)
            self.assertTrue(process_file(file, write=True))
            self.assertEqual(json.loads(file.read_bytes()), {'path': '~/source', 'time': 1.25})
            self.assertFalse(process_file(file, write=True))

    def test_gzip_payload_and_header(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'data.json.gz'
            with file.open('wb') as target:
                with gzip.GzipFile(filename='private-original.json', fileobj=target, mode='wb') as output:
                    output.write(('"/' + 'Users/example-person/source"').encode())
            self.assertTrue(process_file(file, write=True))
            self.assertEqual(gzip.decompress(file.read_bytes()), b'"~/source"')
            self.assertEqual(file.read_bytes()[3] & 0x18, 0)
            self.assertFalse(process_file(file))

    def test_tar_content_ownership_and_links_without_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'audit.tar.gz'
            home = '/' + 'home/example-person'
            with tarfile.open(file, 'w:gz', format=tarfile.PAX_FORMAT) as archive:
                member = tarfile.TarInfo('audit/1.jsonl')
                member.uname = member.gname = 'example-person'
                member.uid = member.gid = 1234
                member.pax_headers = {'uname': 'example-person', 'comment': home}
                data = json.dumps({'resource': home + '/entry.js'}).encode()
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
                link = tarfile.TarInfo('audit/link')
                link.type = tarfile.SYMTYPE
                link.linkname = home + '/entry.js'
                archive.addfile(link)
            self.assertTrue(process_file(file, write=True))
            with tarfile.open(file) as archive:
                member = archive.getmember('audit/1.jsonl')
                self.assertEqual((member.uname, member.gname, member.uid, member.gid), ('', '', 0, 0))
                self.assertEqual(member.pax_headers, {'comment': '~'})
                self.assertEqual(json.load(archive.extractfile(member)), {'resource': '~/entry.js'})
                self.assertEqual(archive.getmember('audit/link').linkname, '~/entry.js')
            self.assertFalse((Path(directory) / 'audit').exists())
            self.assertFalse(process_file(file))

    def test_credentials_and_binary_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'possible credential'):
            sanitize_bytes(('ghp_' + 'x' * 24).encode(), 'sample')
        with self.assertRaisesRegex(ValueError, 'unsupported binary'):
            sanitize_bytes(b'\xff\x00', 'sample')

    def test_tar_gzip_header_only(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'audit.tar.gz'
            with file.open('wb') as target:
                with gzip.GzipFile(filename='private-archive.tar', fileobj=target, mode='wb') as compressed:
                    with tarfile.open(fileobj=compressed, mode='w|') as archive:
                        archive.addfile(tarfile.TarInfo('empty'))
            self.assertTrue(process_file(file))
            self.assertTrue(process_file(file, write=True))
            self.assertEqual(file.read_bytes()[3] & 0x18, 0)
            self.assertFalse(process_file(file))


if __name__ == '__main__':
    unittest.main()

"""Run tests against a new disposable Postgres.app cluster, never recovery_dev."""
import os
import pathlib
import socket
import subprocess
import tempfile

bin_dir = pathlib.Path(os.environ.get('POSTGRES_BIN', '/Applications/Postgres.app/Contents/Versions/latest/bin'))
if not (bin_dir / 'initdb').exists():
    raise SystemExit('Set POSTGRES_BIN to a PostgreSQL installation containing initdb and pg_ctl.')
with tempfile.TemporaryDirectory(prefix='recovery-tests-') as directory:
    root = pathlib.Path(directory)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    # Trust is restricted to the disposable loopback-only test cluster. No fake password.
    subprocess.run([str(bin_dir/'initdb'), '-D', str(root/'data'), '-A', 'trust', '--encoding=UTF8', '--no-locale'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([str(bin_dir/'pg_ctl'), '-D', str(root/'data'), '-l', str(root/'postgres.log'), '-o', f'-h 127.0.0.1 -p {port} -k {directory}', '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
    try:
        database_name = 'recovery_test_isolated'
        subprocess.run([str(bin_dir/'createdb'), '-h', '127.0.0.1', '-p', str(port), database_name], check=True)
        env = {**os.environ, 'TEST_PGHOST': '127.0.0.1', 'TEST_PGPORT': str(port), 'TEST_PGDATABASE': database_name}
        # libpq/pg must use the current local OS role in the disposable cluster.
        import getpass
        env['TEST_PGUSER'] = getpass.getuser()
        env.pop('TEST_PGPASSWORD', None)
        if env.get('RUN_LIVE_PIPELINE') == '1':
            import pymupdf
            document = pymupdf.open()
            page = document.new_page()
            page.insert_text((72, 72), 'Doctor instructions: Walk slowly for 5 minutes daily at 09:00 for 2 days.', fontsize=16)
            sample = root / 'fictional.pdf'
            document.save(sample)
            document.close()
            env['TEST_DOCUMENT_PATH'] = str(sample)
        result = subprocess.run(['node', '--import', 'tsx', '--test', 'tests/persistence.test.ts'], env=env)
    finally:
        subprocess.run([str(bin_dir/'pg_ctl'), '-D', str(root/'data'), '-w', 'stop', '-m', 'fast'], check=True, stdout=subprocess.DEVNULL)
    raise SystemExit(result.returncode)

-- App "Precios Carritos": abre la página de precios de carritos (Hot Wheels, Matchbox, Cars).
-- Si la página no está corriendo, la arranca en segundo plano (sin terminal) y luego la abre en el navegador.
-- Se crea una sola vez con:
--   mkdir -p ~/Applications && osacompile -o ~/Applications/"Precios Carritos.app" ~/Developer/hgshop/scripts/precios/precios-carritos.applescript

set hgshop to (POSIX path of (path to home folder)) & "Developer/hgshop"
set direccion to "http://localhost:4400"

on estaCorriendo()
	try
		do shell script "curl -s -o /dev/null --max-time 1 http://localhost:4400/api/album/estado"
		return true
	on error
		return false
	end try
end estaCorriendo

if not estaCorriendo() then
	-- zsh -lic carga tu configuración (node, GEMINI_API_KEY)
	do shell script "/bin/zsh -lic " & quoted form of ("cd " & quoted form of hgshop & " && nohup node scripts/precios/revisar.mjs --sin-abrir > scripts/salida/pagina.log 2>&1 &")
	set listo to false
	repeat 60 times
		delay 0.5
		if estaCorriendo() then
			set listo to true
			exit repeat
		end if
	end repeat
	if not listo then
		display dialog "La página de precios no arrancó. Revisa el archivo scripts/salida/pagina.log en hgshop." buttons {"OK"} default button 1 with icon caution
		return
	end if
end if

open location direccion

package io.jxcore.node;

import android.bluetooth.BluetoothSocket;
import android.util.Log;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;

/**
 *
 */
public class OutgoingSocketThread extends SocketThreadBase {

    private static final String TAG = OutgoingSocketThread.class.getName();
    private ServerSocket mServerSocket = null;

    /**
     * Constructor.
     * @param bluetoothSocket
     * @param listener
     * @throws IOException
     */
    public OutgoingSocketThread(BluetoothSocket bluetoothSocket, ConnectionStatusListener listener)
            throws IOException {
        super(bluetoothSocket, listener);
        Log.i(TAG, "Constructed");
    }

    /**
     * From Thread.
     */
    @Override
    public void run() {
        try {
            mServerSocket = new ServerSocket(0);
            Log.i(TAG, "Server socket local port: " + mServerSocket.getLocalPort());
        } catch (IOException e) {
            Log.e(TAG, "Failed to create a server socket instance: " + e.getMessage(), e);
            mServerSocket = null;
            mListener.onDisconnected(this, "Failed to create a server socket instance: " + e.getMessage());
        }

        if (mServerSocket != null) {
            InputStream tempInputStream = null;
            OutputStream tempOutputStream = null;
            boolean localStreamsCreatedSuccessfully = false;

            try {
                if (mListener != null) {
                    mListener.onListeningForIncomingConnections(mServerSocket.getLocalPort());
                }

                Log.i(TAG, "Now accepting connections...");

                Socket tempSocket = mServerSocket.accept(); // Blocking call

                closeLocalSocketAndStreams();
                mLocalhostSocket = tempSocket;

                Log.i(TAG, "Incoming data from: " + getLocalHostAddressAsString()
                        + ", port: " + getLocalHostPort());
                tempInputStream = mLocalhostSocket.getInputStream();
                tempOutputStream = mLocalhostSocket.getOutputStream();
                localStreamsCreatedSuccessfully = true;
            } catch (IOException e) {
                Log.e(TAG, "Failed to create local streams: " + e.getMessage(), e);
                mListener.onDisconnected(this, "Failed to create local streams: " + e.getMessage());
            }

            if (localStreamsCreatedSuccessfully) {
                Log.i(TAG, "Setting local streams and starting stream copying threads...");
                mLocalInputStream = tempInputStream;
                mLocalOutputStream = tempOutputStream;
                startStreamCopyingThreads();
            }
        }

        Log.i(TAG, "Exiting thread");
    }

    /**
     *
     */
    public synchronized void close() {
        Log.i(TAG, "close");
        super.close();

        if (mServerSocket != null) {
            try {
                mServerSocket.close();
            } catch (IOException e) {
                Log.e(TAG, "Failed to close the server socket: " + e.getMessage(), e);
            }

            mServerSocket = null;
        }
    }

    private int getLocalHostPort() {
        return mServerSocket == null ? 0 : mServerSocket.getLocalPort();
    }
}
